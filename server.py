import os
import base64
import httpx
from pathlib import Path
from fastapi import FastAPI, Request, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Target the Docker Compose Pipeline Service (Standard Port 8080)
PADDLE_SERVICE_URL = os.getenv("PADDLE_SERVICE_URL", "http://localhost:8080/layout-parsing")

# Create directory for OCR images
OCR_IMAGES_DIR = Path("static/ocr_images")
OCR_IMAGES_DIR.mkdir(exist_ok=True)

app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/")
async def read_root():
    return FileResponse("static/index.html")

@app.get("/api/models")
async def get_models():
    """Mock response for frontend compatibility"""
    return {"data": [{"id": "PaddleOCR-VL-Pipeline"}]}

class OCRRequest(BaseModel):
    image: str # Base64 string
    useLayoutDetection: bool = True
    useDocUnwarping: bool = False  # Match app.py default
    useDocOrientationClassify: bool = False  # Match app.py default
    useChartRecognition: bool = False

@app.post("/api/ocr")
async def proxy_ocr(request: OCRRequest):
    """Proxy request to PaddleOCR-VL Pipeline Service"""
    try:
        # Clean Base64 String
        # Frontend sends "data:image/jpeg;base64,/9j/4AAQ..."
        # We need to strip the header part before sending to Paddle
        base64_data = request.image
        if "base64," in base64_data:
            base64_data = base64_data.split("base64,")[1]
            
        # Construct Payload for the Official Pipeline API (matching app.py line 163-175)
        payload = {
            "file": base64_data,
            "fileType": 1,
            "useLayoutDetection": request.useLayoutDetection,
            "useDocUnwarping": request.useDocUnwarping,
            "useDocOrientationClassify": request.useDocOrientationClassify
        }
        
        if request.useLayoutDetection and request.useChartRecognition:
            payload["useChartRecognition"] = True
        
        print(f"Sending request to Pipeline Service at {PADDLE_SERVICE_URL}...")
        
        async with httpx.AsyncClient(timeout=180.0) as client:
            resp = await client.post(
                PADDLE_SERVICE_URL,
                json=payload,
                headers={"Content-Type": "application/json"}
            )
            
            if resp.status_code != 200:
                print(f"Service Error: {resp.text}")
                # Provide a more helpful error if it's the specific OpenCV error
                if "500 Internal Server Error" in str(resp.status_code):
                   print("Pipeline crashed processing this image. It might be empty or corrupted.")
                raise HTTPException(status_code=resp.status_code, detail=f"Upstream error: {resp.text}")
            
            data = resp.json()
            
            # Parse Official Response Format
            if "result" in data and "layoutParsingResults" in data["result"]:
                results = data["result"]["layoutParsingResults"]
                full_markdown = ""
                
                for page_idx, res in enumerate(results):
                    if "markdown" in res and "text" in res["markdown"]:
                        md_text = res["markdown"]["text"]
                        md_images = res["markdown"].get("images", {})
                        
                        # Save images and replace paths
                        if md_images:
                            for img_path, img_base64 in md_images.items():
                                # Save image to static/ocr_images/
                                img_filename = Path(img_path).name
                                img_save_path = OCR_IMAGES_DIR / img_filename
                                
                                # Decode and save
                                img_data = base64.b64decode(img_base64)
                                with open(img_save_path, "wb") as f:
                                    f.write(img_data)
                                
                                # Replace path in markdown (from "imgs/xxx.jpg" to "/static/ocr_images/xxx.jpg")
                                md_text = md_text.replace(img_path, f"/static/ocr_images/{img_filename}")
                        
                        full_markdown += md_text + "\n\n"
                
                return {"markdown": full_markdown}
            else:
                print(f"Unexpected Format: {data}")
                raise HTTPException(status_code=500, detail="Unexpected response format from Pipeline")
            
    except Exception as e:
        print(f"Proxy Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    print(f"Starting server... Target Pipeline: {PADDLE_SERVICE_URL}")
    uvicorn.run(app, host="0.0.0.0", port=8000)
