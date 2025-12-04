// Configuration
const API_BASE = '/api';
let availableModel = 'PaddleOCR-VL-Pipeline'; // Default model name for UI
const PROMPT_TEXT = ""; // Not used in pipeline mode

// Configure marked.js with LaTeX support
marked.setOptions({
    breaks: true,
    gfm: true,
    sanitize: false
});

// State
let processQueue = [];
let isProcessing = false;
let processedResults = [];
let currentView = 'single';
let currentTab = 'preview';

// DOM Elements
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const browseBtn = document.getElementById('browse-btn');
const queueSection = document.getElementById('processing-queue');
const queueList = document.getElementById('queue-list');
const resultsSection = document.getElementById('results-section');
const resultsContainer = document.getElementById('results-container');
const statusDot = document.getElementById('model-status-dot');
const statusText = document.getElementById('model-status-text');
const progressText = document.getElementById('progress-text');
const selectAllBtn = document.getElementById('select-all-btn');
const selectNoneBtn = document.getElementById('select-none-btn');
const clearBtn = document.getElementById('clear-all-btn');
const downloadAllBtn = document.getElementById('download-all-btn');
const startBtn = document.getElementById('start-btn');
const chartRecognitionSwitch = document.getElementById('chart-recognition-switch');
const docUnwarpingSwitch = document.getElementById('doc-unwarping-switch');
const docOrientationSwitch = document.getElementById('doc-orientation-switch');
const toggleOptionsBtn = document.getElementById('toggle-options-btn');
const ocrOptionsContainer = document.getElementById('ocr-options-container');

// 多页视图元素
const singleViewBtn = document.getElementById('single-page-btn');
const multiViewBtn = document.getElementById('multi-page-btn');
const previewTab = document.getElementById('multi-md-preview-btn');
const sourceTab = document.getElementById('multi-md-source-btn');
const multiPageContainer = document.getElementById('multi-page-view');
const mdPreview = document.getElementById('multi-md-preview');
const mdSource = document.getElementById('multi-md-source');

// Templates
const queueItemTemplate = document.getElementById('queue-item-template');
const resultCardTemplate = document.getElementById('result-card-template');

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    // Set PDF.js worker
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    
    await checkBackendConnection();
    setupEventListeners();
    // 初始化解析选项折叠功能
    initOcrOptionsToggle();
});

async function checkBackendConnection() {
    try {
        const response = await fetch(`${API_BASE}/models`);
        if (response.ok) {
            const data = await response.json();
            if (data.data && data.data.length > 0) {
                availableModel = data.data[0].id;
                console.log('Connected. Using model:', availableModel);
            }
            statusDot.className = 'dot connected';
            statusText.textContent = '已连接到 ' + availableModel;
        } else {
            throw new Error('API Error');
        }
    } catch (err) {
        console.error('Connection failed:', err);
        statusDot.className = 'dot error';
        statusText.textContent = '连接失败 (请检查 VLLM 是否运行)';
        // Retry after 5s
        setTimeout(checkBackendConnection, 5000);
    }
}

function setupEventListeners() {
    // 解析选项折叠按钮
    toggleOptionsBtn.addEventListener('click', toggleOcrOptions);
    
    // Drag & Drop
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('drag-over');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('drag-over');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        handleFiles(e.dataTransfer.files);
    });

    // File Input
    browseBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
        handleFiles(e.target.files);
        // Reset file input so same file can be selected again
        e.target.value = '';
    });

    // Actions
clearBtn.addEventListener('click', clearQueue);
downloadAllBtn.addEventListener('click', downloadAllMarkdown);
startBtn.addEventListener('click', startProcessing);
selectAllBtn.addEventListener('click', selectAll);
selectNoneBtn.addEventListener('click', selectNone);

    // 视图切换（添加空值检查）
    if (singleViewBtn) singleViewBtn.addEventListener('click', () => switchView('single'));
    if (multiViewBtn) multiViewBtn.addEventListener('click', () => switchView('multi'));
    
    // 标签页切换（添加空值检查）
    if (previewTab) previewTab.addEventListener('click', () => switchTab('preview'));
    if (sourceTab) sourceTab.addEventListener('click', () => switchTab('source'));

    // 粘贴图片功能
    document.addEventListener('paste', handlePaste);
}

// 初始化OCR选项折叠功能
function initOcrOptionsToggle() {
    if (toggleOptionsBtn && ocrOptionsContainer) {
        // 确保初始状态是折叠的
        ocrOptionsContainer.classList.add('hidden');
        toggleOptionsBtn.textContent = '▶';
    }
}

// 切换OCR选项显示
function toggleOcrOptions() {
    if (ocrOptionsContainer && toggleOptionsBtn) {
        const isHidden = ocrOptionsContainer.classList.toggle('hidden');
        // 更新按钮图标和旋转效果
        if (isHidden) {
            toggleOptionsBtn.textContent = '▶';
            toggleOptionsBtn.classList.remove('rotated');
        } else {
            toggleOptionsBtn.textContent = '▼';
            toggleOptionsBtn.classList.add('rotated');
        }
    }
}

// 处理粘贴事件
function handlePaste(e) {
    const items = e.clipboardData.items;
    if (!items) return;

    const files = [];
    let hasImage = false;

    for (const item of items) {
        if (item.type.startsWith('image/')) {
            hasImage = true;
            const blob = item.getAsFile();
            const timestamp = new Date().getTime();
            const fileName = `paste_${timestamp}.png`;
            const file = new File([blob], fileName, { type: 'image/png' });
            files.push(file);
        }
    }

    if (hasImage) {
        e.preventDefault();
        handleFiles(files);
        
        // 显示拖放区域的视觉反馈
        dropZone.classList.add('drag-over');
        setTimeout(() => {
            dropZone.classList.remove('drag-over');
        }, 500);
    }
}

async function handleFiles(files) {
    if (!files || files.length === 0) return;

    queueSection.classList.remove('hidden');
    
    for (const file of files) {
        if (file.type === 'application/pdf') {
            await processPDF(file);
        } else if (file.type.startsWith('image/')) {
            await processImage(file);
        }
    }

    updateQueueProgress();
    // REMOVED: processNextInQueue(); - Now waits for user to click start
}

function startProcessing() {
    if (processQueue.length === 0) {
        alert('请先添加文件');
        return;
    }
    if (!isProcessing) {
        processNextInQueue();
    }
}

async function processImage(file) {
    const reader = new FileReader();
    return new Promise((resolve) => {
        reader.onload = (e) => {
            addToQueue({
                id: Math.random().toString(36).substr(2, 9),
                file: file,
                type: 'image',
                dataUrl: e.target.result,
                name: file.name,
                status: 'pending'
            });
            resolve();
        };
        reader.readAsDataURL(file);
    });
}

async function processPDF(file) {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument(arrayBuffer).promise;
    
    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 2.0 }); // Scale up for better OCR
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        await page.render({ canvasContext: context, viewport: viewport }).promise;
        
        addToQueue({
            id: Math.random().toString(36).substr(2, 9),
            file: file,
            type: 'pdf_page',
            dataUrl: canvas.toDataURL('image/jpeg', 0.9),
            name: `${file.name} (第 ${i} 页)`,
            pageNum: i,
            status: 'pending'
        });
    }
}

function addToQueue(item) {
    processQueue.push(item);
    renderQueueItem(item);
}

function renderQueueItem(item) {
    const clone = queueItemTemplate.content.cloneNode(true);
    const el = clone.querySelector('.queue-item');
    el.id = `queue-${item.id}`;
    
    // Set checkbox
    const checkbox = el.querySelector('.queue-checkbox');
    checkbox.dataset.itemId = item.id;
    checkbox.checked = true; // 默认选中
    
    // Truncate long names for vertical cards (more space available)
    let displayName = item.name;
    if (displayName.length > 25) {
        displayName = displayName.substring(0, 22) + '...';
    }
    
    el.querySelector('.file-name').textContent = displayName;
    el.querySelector('.file-name').title = item.name; // Full name on hover
    el.querySelector('.thumbnail').src = item.dataUrl;
    el.querySelector('.file-status').textContent = '待处理';
    queueList.appendChild(el);
    
    // Auto-scroll to the newest item (vertical scroll now)
    setTimeout(() => {
        queueList.scrollTop = queueList.scrollHeight;
    }, 100);
}

function updateQueueProgress() {
    const total = processQueue.length + processedResults.length; // Simplified logic
    const pending = processQueue.filter(i => i.status === 'pending').length;
    const processing = processQueue.filter(i => i.status === 'processing').length;
    const done = processQueue.filter(i => i.status === 'completed').length; // We actually remove from queue array but let's keep it simple visually
    
    progressText.textContent = `已完成 ${processedResults.length} / 剩余 ${processQueue.length}`;
}

async function processNextInQueue() {
    if (isProcessing || processQueue.length === 0) return;

    // Get the next selected and pending item
    const itemIndex = processQueue.findIndex(item => {
        if (item.status !== 'pending') return false;
        // Check if the item is selected
        const el = document.getElementById(`queue-${item.id}`);
        if (!el) return false;
        const checkbox = el.querySelector('.queue-checkbox');
        return checkbox && checkbox.checked;
    });
    
    if (itemIndex === -1) {
        // All done - remove processing state from queue section
        queueSection.classList.remove('processing');
        return;
    }

    isProcessing = true;
    const item = processQueue[itemIndex];
    item.status = 'processing';
    
    // Add processing state to queue section
    queueSection.classList.add('processing');
    
    // Update UI with animations
    const el = document.getElementById(`queue-${item.id}`);
    if (el) {
        el.classList.add('processing');
        el.querySelector('.file-status').textContent = '处理中...';
        el.querySelector('.file-status').style.color = 'var(--accent-color)';
        
        const progressBar = el.querySelector('.progress-bar');
        progressBar.classList.add('loading');
    }

    try {
        const markdown = await callVLLM(item.dataUrl);
        
        // Success
        item.status = 'completed';
        item.markdown = markdown;
        
        if (el) {
            el.classList.remove('processing');
            el.classList.add('completed');
            el.querySelector('.file-status').textContent = '完成';
            el.querySelector('.file-status').style.color = 'var(--success-color)';
            
            const progressBar = el.querySelector('.progress-bar');
            progressBar.classList.remove('loading');
            progressBar.style.width = '100%';
            progressBar.style.background = 'var(--success-color)';
        }

        processedResults.push(item);
    renderResult(item);
    
    // 更新多页视图
    if (currentView === 'multi') {
        updateMultiPageView();
    }
    
    // Play a subtle success animation
    if (el) {
        setTimeout(() => {
            el.style.transition = 'all 0.3s ease';
            el.style.transform = 'scale(0.98)';
            setTimeout(() => {
                el.style.transform = 'scale(1)';
            }, 150);
        }, 100);
    }

    } catch (error) {
        console.error(error);
        item.status = 'error';
        if (el) {
            el.classList.remove('processing');
            el.classList.add('error');
            el.querySelector('.file-status').textContent = '失败';
            el.querySelector('.file-status').style.color = 'var(--error-color)';
            
            const progressBar = el.querySelector('.progress-bar');
            progressBar.classList.remove('loading');
            progressBar.style.backgroundColor = 'var(--error-color)';
            progressBar.style.width = '100%';
        }
    } finally {
        isProcessing = false;
        updateQueueProgress();
        // Slight delay - Check if we should continue
        setTimeout(processNextInQueue, 500);
    }
}

async function callVLLM(base64Image) {
    // Use our backend proxy which talks to the Official Pipeline Service (Docker Compose 8080)
    // Read user's configuration choices (matching app.py line 370-376)
    const payload = {
        image: base64Image,
        useLayoutDetection: true,  // Always use layout detection for document parsing
        useChartRecognition: chartRecognitionSwitch.checked,
        useDocUnwarping: docUnwarpingSwitch.checked,
        useDocOrientationClassify: docOrientationSwitch.checked
    };

    const response = await fetch(`${API_BASE}/ocr`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const err = await response.text();
        throw new Error(`API Error: ${err}`);
    }

    const data = await response.json();
    return data.markdown;
}

function renderResult(item) {
    // Remove empty state if it exists
    const emptyState = resultsContainer.querySelector('.empty-state');
    if (emptyState) {
        emptyState.remove();
    }
    
    const clone = resultCardTemplate.content.cloneNode(true);
    const card = clone.querySelector('.result-card');
    
    card.querySelector('.page-number').textContent = item.name;
    const img = card.querySelector('.image-preview img');
    img.src = item.dataUrl;
    
    // 确保图片加载完成后调整大小
    img.onload = function() {
        // 直接设置图片样式，确保正确的尺寸
        this.style.width = '100%';
        this.style.maxWidth = '100%';
        this.style.height = 'auto';
        this.style.maxHeight = 'calc(100% - 30px)';
        this.style.objectFit = 'contain';
    };
    
    // 添加放大功能事件监听
    setupZoomFunctionality(card, img);
    
    // Get elements
    const markdownPreview = card.querySelector('.markdown-preview');
    const markdownEditor = card.querySelector('.markdown-editor');
    const togglePreviewBtn = card.querySelector('.toggle-preview');
    const toggleEditBtn = card.querySelector('.toggle-edit');
    const toggleKatexBtn = card.querySelector('.toggle-katex');
    const copyBtn = card.querySelector('.copy-btn');
    
    // Track current rendering mode (default or katex)
    let currentRenderMode = 'default';
    
    // Set initial editor content
    markdownEditor.value = item.markdown || '(无内容)';
    
    // Render markdown function
    const renderMarkdown = () => {
        const content = markdownEditor.value;
        
        // Simple approach: render all content with marked.js
        // 使用marked解析Markdown
        const renderer = new marked.Renderer();
        
        // 使用marked解析内容
        const markedOptions = {
            renderer: renderer,
            gfm: true,
            breaks: true,
            sanitize: false,
            mangle: false, // 禁用电子邮件地址混淆
            headerIds: false // 禁用自动生成标题ID
        };
        
        // 使用marked解析内容
        const mdHtml = marked.parse(content, markedOptions);
        
        if (currentRenderMode === 'katex') {
            // 在KaTeX渲染模式下，使用katex渲染LaTeX
            markdownPreview.innerHTML = mdHtml;
            
            // 使用KaTeX渲染页面中的LaTeX公式
            if (typeof renderMathInElement !== 'undefined') {
                renderMathInElement(markdownPreview, {
                    delimiters: [
                        {left: "$$", right: "$$", display: true},
                        {left: "$", right: "$", display: false},
                        {left: "\\(", right: "\\)", display: false},
                        {left: "\\[", right: "\\]", display: true}
                    ],
                    throwOnError: false
                });
            }
        } else {
            // 默认模式下，只使用marked渲染
            markdownPreview.innerHTML = mdHtml;
        }
        
        // Update item's markdown
        item.markdown = content;
        
        // Update multi-page view if needed
        if (currentView === 'multi') {
            updateMultiPageView();
        }
    };
    
    // Initial render
    renderMarkdown();
    
    // Setup mode toggle buttons
    togglePreviewBtn.addEventListener('click', () => {
        togglePreviewBtn.classList.add('active');
        toggleEditBtn.classList.remove('active');
        toggleKatexBtn.classList.remove('active');
        markdownPreview.classList.remove('hidden');
        markdownEditor.classList.add('hidden');
        currentRenderMode = 'default';
        renderMarkdown(); // Update preview from editor content
    });
    
    toggleEditBtn.addEventListener('click', () => {
        toggleEditBtn.classList.add('active');
        togglePreviewBtn.classList.remove('active');
        toggleKatexBtn.classList.remove('active');
        markdownEditor.classList.remove('hidden');
        markdownPreview.classList.add('hidden');
        markdownEditor.focus();
    });
    
    // Add event listener for KaTeX toggle button
    toggleKatexBtn.addEventListener('click', () => {
        toggleKatexBtn.classList.add('active');
        togglePreviewBtn.classList.remove('active');
        toggleEditBtn.classList.remove('active');
        markdownPreview.classList.remove('hidden');
        markdownEditor.classList.add('hidden');
        currentRenderMode = 'katex';
        renderMarkdown(); // Update preview with KaTeX rendering
    });
    
    // Update markdown in real-time when editing
    markdownEditor.addEventListener('input', renderMarkdown);
    
    // Setup copy button
    copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(item.markdown).then(() => {
            copyBtn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>';
            setTimeout(() => {
                copyBtn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
            }, 2000);
        });
    });
    
    resultsContainer.appendChild(card);
    updateQueueProgress();
}

// 设置图片放大功能
function setupZoomFunctionality(card, imgElement) {
    const zoomBtn = card.querySelector('.zoom-btn');
    const zoomPreview = card.querySelector('.zoom-preview');
    const zoomPreviewContent = card.querySelector('.zoom-preview-content');
    const zoomCloseBtn = card.querySelector('.zoom-close-btn');
    let isZoomEnabled = false;
    
    // 设置放大预览内容
    zoomPreviewContent.style.backgroundImage = `url('${imgElement.src}')`;
    
    // 关闭放大预览的函数
    function closeZoomPreview() {
        isZoomEnabled = false;
        zoomBtn.classList.remove('active');
        zoomPreview.style.display = 'none';
        imgElement.style.cursor = 'default';
    }
    
    // 放大按钮点击事件
    zoomBtn.addEventListener('click', () => {
        isZoomEnabled = !isZoomEnabled;
        zoomBtn.classList.toggle('active');
        
        if (isZoomEnabled) {
            zoomPreview.style.display = 'block';
            imgElement.style.cursor = 'crosshair';
        } else {
            zoomPreview.style.display = 'none';
            imgElement.style.cursor = 'default';
        }
    });
    
    // 关闭按钮点击事件
    zoomCloseBtn.addEventListener('click', closeZoomPreview);
    
    // 鼠标移动事件
    imgElement.addEventListener('mousemove', (e) => {
        if (!isZoomEnabled) return;
        
        const imgRect = imgElement.getBoundingClientRect();
        const x = e.clientX - imgRect.left;
        const y = e.clientY - imgRect.top;
        
        // 计算鼠标在图片上的百分比位置
        const xPercent = (x / imgRect.width) * 100;
        const yPercent = (y / imgRect.height) * 100;
        
        // 设置放大预览的背景位置
        zoomPreviewContent.style.backgroundPosition = `${xPercent}% ${yPercent}%`;
        
        // 调整放大预览窗口中图片的宽度，使其与预览窗口一样宽
        const previewWidth = zoomPreview.offsetWidth;
        const aspectRatio = imgElement.naturalHeight / imgElement.naturalWidth;
        const previewHeight = previewWidth * aspectRatio;
        
        zoomPreviewContent.style.backgroundSize = `${previewWidth}px ${previewHeight}px`;
    });
    
    // 移除鼠标离开图片时自动关闭的行为
    // 移除鼠标进入图片事件
    // 移除鼠标离开预览窗口事件
    // 移除鼠标进入预览窗口事件
}

function clearQueue() {
    processQueue = [];
    processedResults = [];
    queueList.innerHTML = '';
    resultsContainer.innerHTML = `
        <div class="empty-state">
            <svg viewBox="0 0 24 24" width="48" height="48" stroke="currentColor" stroke-width="1.5" fill="none">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
                <line x1="16" y1="13" x2="8" y2="13"></line>
                <line x1="16" y1="17" x2="8" y2="17"></line>
                <polyline points="10 9 9 9 8 9"></polyline>
            </svg>
            <p>上传文件后，解析结果将在此显示</p>
        </div>
    `;
    
    // 清空多页视图（添加空值检查）
    if (mdPreview) mdPreview.innerHTML = '';
    if (mdSource) mdSource.value = '';
    
    queueSection.classList.add('hidden');
    updateQueueProgress();
}

// 全选功能
function selectAll() {
    const checkboxes = document.querySelectorAll('.queue-checkbox');
    checkboxes.forEach(checkbox => {
        checkbox.checked = true;
    });
}

// 全不选功能
function selectNone() {
    const checkboxes = document.querySelectorAll('.queue-checkbox');
    checkboxes.forEach(checkbox => {
        checkbox.checked = false;
    });
}

// 切换视图
function switchView(view) {
    currentView = view;
    
    if (view === 'single') {
        if (singleViewBtn) singleViewBtn.classList.add('active');
        if (multiViewBtn) multiViewBtn.classList.remove('active');
        resultsContainer.style.display = 'flex';
        if (multiPageContainer) multiPageContainer.classList.remove('active');
    } else {
        if (singleViewBtn) singleViewBtn.classList.remove('active');
        if (multiViewBtn) multiViewBtn.classList.add('active');
        resultsContainer.style.display = 'none';
        if (multiPageContainer) multiPageContainer.classList.add('active');
        updateMultiPageView();
    }
}

// 切换标签页
function switchTab(tab) {
    currentTab = tab;
    
    if (tab === 'preview') {
        if (previewTab) previewTab.classList.add('active');
        if (sourceTab) sourceTab.classList.remove('active');
        if (mdPreview) mdPreview.classList.add('active');
        if (mdSource) mdSource.classList.remove('active');
    } else {
        if (previewTab) previewTab.classList.remove('active');
        if (sourceTab) sourceTab.classList.add('active');
        if (mdPreview) mdPreview.classList.remove('active');
        if (mdSource) mdSource.classList.add('active');
    }
}

// 更新多页视图
function updateMultiPageView() {
    if (processedResults.length === 0) {
        if (mdPreview) mdPreview.innerHTML = '<p style="color: var(--text-secondary); text-align: center; padding: 20px;">暂无结果</p>';
        if (mdSource) mdSource.value = '';
        return;
    }
    
    // 合并所有结果的Markdown
    const mergedMarkdown = processedResults.map(result => result.markdown).join('\n\n---\n\n');
    
    // 更新预览和源码
    if (mdPreview) {
        // 使用marked解析Markdown
        const renderer = new marked.Renderer();
        
        // 使用marked解析内容
        const markedOptions = {
            renderer: renderer,
            gfm: true,
            breaks: true,
            sanitize: false,
            mangle: false, // 禁用电子邮件地址混淆
            headerIds: false // 禁用自动生成标题ID
        };
        
        // 使用marked解析内容
        const mdHtml = marked.parse(mergedMarkdown, markedOptions);
        
        mdPreview.innerHTML = mdHtml;
    }
    if (mdSource) {
        const codeElement = mdSource.querySelector('code.markdown');
        if (codeElement) codeElement.textContent = mergedMarkdown;
    }
}

async function downloadAllMarkdown() {
    if (processedResults.length === 0) {
        alert('没有可下载的结果');
        return;
    }
    
    const totalPages = processedResults.length;
    let combinedMarkdown = '';
    let imageUrls = new Set();
    
    // Add summary header
    combinedMarkdown += `# OCR 识别结果\n\n`;
    combinedMarkdown += `- 总页数/文件数：${totalPages}\n`;
    combinedMarkdown += `- 生成时间：${new Date().toLocaleString('zh-CN')}\n\n`;
    combinedMarkdown += `---\n\n`;
    
    processedResults.forEach((item, idx) => {
        combinedMarkdown += `<!-- 页面 ${idx + 1}/${totalPages}: ${item.name} -->\n\n`;
        
        // Extract image URLs and convert to relative paths
        let markdown = item.markdown;
        
        // Find all /static/ocr_images/ URLs
        const imgRegex = /\/static\/ocr_images\/([^\s"')]+)/g;
        let match;
        while ((match = imgRegex.exec(markdown)) !== null) {
            imageUrls.add(match[1]); // Store filename (using Set to avoid duplicates)
        }
        
        // Replace absolute paths with relative paths
        markdown = markdown.replace(/\/static\/ocr_images\//g, 'ocr_images/');
        
        combinedMarkdown += markdown + '\n\n';
        
        // Add separator between pages (except last page)
        if (idx < totalPages - 1) {
            combinedMarkdown += '---\n\n';
        }
    });
    
    // If there are images, create a ZIP package
    if (imageUrls.size > 0) {
        console.log(`准备打包：${totalPages} 个页面，${imageUrls.size} 张图片`);
        
        downloadAllBtn.textContent = '准备打包...';
        downloadAllBtn.disabled = true;
        
        try {
            const zip = new JSZip();
            
            // Add markdown file with summary
            const mdHeader = `<!-- 此文档包含 ${totalPages} 个页面和 ${imageUrls.size} 张图片 -->\n\n`;
            zip.file('README.md', mdHeader + combinedMarkdown);
            
            // Create images folder and add all images
            const imgFolder = zip.folder('ocr_images');
            let downloadedCount = 0;
            let failedCount = 0;
            
            for (const filename of imageUrls) {
                try {
                    downloadAllBtn.textContent = `下载图片 ${downloadedCount + 1}/${imageUrls.size}`;
                    
                    const response = await fetch(`/static/ocr_images/${filename}`);
                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}`);
                    }
                    const blob = await response.blob();
                    imgFolder.file(filename, blob);
                    downloadedCount++;
                } catch (error) {
                    console.error(`下载失败 ${filename}:`, error);
                    failedCount++;
                }
            }
            
            console.log(`图片下载完成：成功 ${downloadedCount}/${imageUrls.size}，失败 ${failedCount}`);
            
            // Generate and download zip
            downloadAllBtn.textContent = '生成压缩包...';
            const content = await zip.generateAsync({ 
                type: 'blob',
                compression: 'DEFLATE',
                compressionOptions: { level: 6 }
            });
            
            const url = URL.createObjectURL(content);
            const a = document.createElement('a');
            a.href = url;
            a.download = `ocr_results_${totalPages}pages_${imageUrls.size}imgs_${new Date().getTime()}.zip`;
            a.click();
            URL.revokeObjectURL(url);
            
            console.log(`ZIP 文件已生成并下载`);
            
            // Reset button
            downloadAllBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
            下载`;
            downloadAllBtn.disabled = false;
            
            // Show success message
            if (failedCount > 0) {
                alert(`下载完成！\n\n已打包：${totalPages} 页，${downloadedCount} 张图片\n失败：${failedCount} 张图片`);
            }
            
        } catch (error) {
            console.error('打包错误:', error);
            alert('打包失败：' + error.message);
            downloadAllBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
            下载`;
            downloadAllBtn.disabled = false;
        }
    } else {
        // No images, just download markdown
        console.log(`下载纯文本 Markdown：${totalPages} 个页面，无图片`);
        const blob = new Blob([combinedMarkdown], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ocr_results_${totalPages}pages_${new Date().getTime()}.md`;
        a.click();
        URL.revokeObjectURL(url);
        
        // Reset button
        downloadAllBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
        </svg>
        下载`;
        downloadAllBtn.disabled = false;
    }
}
