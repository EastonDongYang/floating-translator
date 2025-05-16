// ==UserScript==
// @name         浮动翻译栏增强版reddit
// @namespace    http://tampermonkey.net/
// @version      0.4
// @description  创建一个浮动输入框，输入中文后等待2-3秒自动翻译为英文，并可监听网页输入框实现自动翻译填充
// @author       Claude & Gemini
// @match        *://**/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      translate.googleapis.com
// ==/UserScript==

(function() {
    'use strict';
    
    // 创建样式
    const style = document.createElement('style');
    style.textContent = `
        #floating-translator {
            position: fixed;
            bottom: 20px;
            right: 20px;
            width: 300px;
            background-color: white;
            border: 1px solid #ccc;
            border-radius: 5px;
            box-shadow: 0 0 10px rgba(0,0,0,0.2);
            z-index: 10000;
            font-family: Arial, sans-serif;
            display: flex;
            flex-direction: column;
        }
        #translator-header {
            padding: 8px;
            background-color: #f0f0f0;
            border-bottom: 1px solid #ccc;
            display: flex;
            justify-content: space-between;
            cursor: move;
            border-radius: 5px 5px 0 0;
        }
        #translator-title {
            font-weight: bold;
            user-select: none;
        }
        #translator-controls {
            display: flex;
            gap: 5px;
        }
        #translator-controls button {
            background: none;
            border: none;
            cursor: pointer;
            font-size: 16px;
        }
        #translator-content {
            padding: 10px;
            display: flex;
            flex-direction: column;
        }
        #translator-content textarea {
            width: 100%;
            height: 80px;
            margin-bottom: 10px;
            border: 1px solid #ddd;
            border-radius: 3px;
            resize: none;
            padding: 5px;
        }
        #translator-output {
            width: 100%;
            min-height: 80px;
            border: 1px solid #ddd;
            border-radius: 3px;
            padding: 5px;
            background-color: #f9f9f9;
            margin-bottom: 10px;
            overflow-y: auto;
            word-break: break-word;
        }
        #translator-controls-bottom {
            display: flex;
            justify-content: space-between;
            flex-wrap: wrap;
            gap: 5px;
        }
        #translator-engine-select {
            padding: 4px;
            border-radius: 3px;
            border: 1px solid #ccc;
        }
        .translator-btn {
            padding: 5px 10px;
            background-color: #4285f4;
            color: white;
            border: none;
            border-radius: 3px;
            cursor: pointer;
        }
        .translator-btn:hover {
            background-color: #3b78e7;
        }
        .minimized {
            height: 36px;
            overflow: hidden;
        }
        .input-control-group {
            display: flex;
            width: 100%;
            gap: 5px;
            margin-top: 5px;
        }
        .status-indicator {
            font-size: 12px;
            color: #666;
            margin-top: 5px;
            font-style: italic;
        }
        .active-element {
            outline: 2px solid #4285f4 !important;
        }
        .pending-translation {
            border-color: #ffa500 !important;
        }
    `;
    document.head.appendChild(style);
    
    // 创建翻译器元素
    const translator = document.createElement('div');
    translator.id = 'floating-translator';
    translator.innerHTML = `
        <div id="translator-header">
            <div id="translator-title">浮动翻译栏</div>
            <div id="translator-controls">
                <button id="translator-minimize">_</button>
                <button id="translator-close">×</button>
            </div>
        </div>
        <div id="translator-content">
            <textarea id="translator-input" placeholder="输入中文文本..."></textarea>
            <div id="translator-output"></div>
            <div id="translator-controls-bottom">
                <select id="translator-engine-select">
                    <option value="google">Google翻译</option>
                    <option value="deepl">DeepL翻译</option>
                </select>
                <button class="translator-btn" id="translator-translate-btn">翻译</button>
            </div>
            <div class="input-control-group">
                <button class="translator-btn" id="translator-select-input">选择输入框</button>
                <button class="translator-btn" id="translator-auto-mode">自动模式: 关闭</button>
            </div>
            <div id="translator-status" class="status-indicator">准备就绪</div>
            <div id="translator-delay-info" class="status-indicator"></div>
        </div>
    `;
    document.body.appendChild(translator);
    
    // 拖动功能
    let isDragging = false;
    let dragOffsetX = 0;
    let dragOffsetY = 0;
    
    const header = document.getElementById('translator-header');
    
    header.addEventListener('mousedown', function(e) {
        isDragging = true;
        const rect = translator.getBoundingClientRect();
        dragOffsetX = e.clientX - rect.left;
        dragOffsetY = e.clientY - rect.top;
        e.preventDefault();
    });
    
    document.addEventListener('mousemove', function(e) {
        if (isDragging) {
            translator.style.left = (e.clientX - dragOffsetX) + 'px';
            translator.style.top = (e.clientY - dragOffsetY) + 'px';
            translator.style.right = 'auto';
            translator.style.bottom = 'auto';
        }
    });
    
    document.addEventListener('mouseup', function() {
        isDragging = false;
    });
    
    // 最小化功能
    const minimizeBtn = document.getElementById('translator-minimize');
    minimizeBtn.addEventListener('click', function() {
        translator.classList.toggle('minimized');
        minimizeBtn.textContent = translator.classList.contains('minimized') ? '□' : '_';
    });
    
    // 关闭功能
    const closeBtn = document.getElementById('translator-close');
    closeBtn.addEventListener('click', function() {
        translator.style.display = 'none';
    });
    
    // 翻译功能
    const input = document.getElementById('translator-input');
    const output = document.getElementById('translator-output');
    const translateBtn = document.getElementById('translator-translate-btn');
    const engineSelect = document.getElementById('translator-engine-select');
    const statusEl = document.getElementById('translator-status');
    const delayInfoEl = document.getElementById('translator-delay-info');
    const selectInputBtn = document.getElementById('translator-select-input');
    const autoModeBtn = document.getElementById('translator-auto-mode');
    
    // 跟踪状态
    let targetInputElement = null;
    let isAutoMode = false;
    let isSelectingInput = false;
    let lastInputValue = '';
    let translationDelayTimer = null;
    let countdownTimer = null;
    let isTyping = false;
    
    // 延迟时间设置（毫秒）
    const TRANSLATION_DELAY = 2500; // 2.5秒
    
    // 状态更新函数
    function updateStatus(message) {
        statusEl.textContent = message;
    }
    
    // 更新延迟信息
    function updateDelayInfo(message) {
        delayInfoEl.textContent = message;
    }
    
    // 使用 Google Translate API 翻译
    function translateWithGoogle(text) {
        const apiUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=zh-CN&tl=en&dt=t&q=${encodeURIComponent(text)}`;
        
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: apiUrl,
                onload: function(response) {
                    try {
                        const data = JSON.parse(response.responseText);
                        let translatedText = '';
                        
                        // 提取翻译结果
                        if (data && data[0]) {
                            for (let i = 0; i < data[0].length; i++) {
                                if (data[0][i][0]) {
                                    translatedText += data[0][i][0];
                                }
                            }
                        }
                        
                        resolve(translatedText);
                    } catch (error) {
                        reject('翻译失败: ' + error.message);
                    }
                },
                onerror: function(error) {
                    reject('翻译请求失败: ' + error.message);
                }
            });
        });
    }
    
    // 使用 DeepL API 翻译
    // 注意：这需要 DeepL API 密钥，免费体验版有使用限制
    // 这里使用模拟实现，实际使用时需要替换为真实的 API 调用
    function translateWithDeepL(text) {
        // 实际使用时，这里应该是 DeepL API 的调用
        // 由于 DeepL API 需要密钥，这里仅作演示，实际上也调用了 Google 的免费接口
        return translateWithGoogle(text);
    }
    
    // 执行翻译
    async function translate() {
        const text = input.value.trim();
        if (!text) {
            output.textContent = '请输入要翻译的文本';
            return null;
        }
        
        // 清除延迟和倒计时
        clearTranslationDelay();
        
        output.textContent = '正在翻译...';
        updateStatus('翻译中...');
        updateDelayInfo('');
        
        try {
            let translatedText;
            const engine = engineSelect.value;
            
            if (engine === 'google') {
                translatedText = await translateWithGoogle(text);
            } else if (engine === 'deepl') {
                translatedText = await translateWithDeepL(text);
            }
            
            output.textContent = translatedText || '翻译结果为空';
            updateStatus('翻译完成');
            return translatedText;
        } catch (error) {
            output.textContent = '翻译出错: ' + error;
            updateStatus('翻译失败: ' + error);
            return null;
        }
    }
    
    // 将翻译结果填入目标输入框
    async function fillTranslationToTargetInput() {
        if (!targetInputElement) {
            updateStatus('未选择目标输入框');
            return;
        }
        
        const translatedText = await translate();
        if (translatedText) {
            setElementContent(targetInputElement, translatedText);
            updateStatus('已将翻译结果填入目标输入框');
        }
    }
    
    // 清除翻译延迟和倒计时
    function clearTranslationDelay() {
        if (translationDelayTimer) {
            clearTimeout(translationDelayTimer);
            translationDelayTimer = null;
        }
        
        if (countdownTimer) {
            clearInterval(countdownTimer);
            countdownTimer = null;
        }
        
        // 移除待翻译状态
        input.classList.remove('pending-translation');
        updateDelayInfo('');
    }
    
    // 开始翻译延迟倒计时
    function startTranslationDelay() {
        clearTranslationDelay();
        
        // 添加待翻译状态
        input.classList.add('pending-translation');
        
        // 设置倒计时
        let remainingTime = Math.ceil(TRANSLATION_DELAY / 1000);
        updateDelayInfo(`等待输入完成... (${remainingTime}秒)`);
        
        countdownTimer = setInterval(function() {
            remainingTime--;
            if (remainingTime <= 0) {
                clearInterval(countdownTimer);
                countdownTimer = null;
            } else {
                updateDelayInfo(`等待输入完成... (${remainingTime}秒)`);
            }
        }, 1000);
        
        // 设置翻译延迟
        translationDelayTimer = setTimeout(function() {
            // 添加判断: 只有当值与最后一次相同时才翻译
            if (input.value.trim() === lastInputValue.trim() && input.value.trim() !== '') {
                isTyping = false;
                translate().then(translatedText => {
                    if (isAutoMode && targetInputElement && translatedText) {
                        setElementContent(targetInputElement, translatedText);
                        updateStatus('自动模式: 已填入翻译结果');
                    }
                });
            }
            translationDelayTimer = null;
            input.classList.remove('pending-translation');
            updateDelayInfo('');
        }, TRANSLATION_DELAY);
    }
    
    // 绑定事件
    translateBtn.addEventListener('click', translate);
    
    // 输入框自动翻译（延迟2.5秒）
    input.addEventListener('input', function() {
        isTyping = true;
        const currentValue = input.value.trim();
        
        // 当输入值发生变化时重置延迟
        if (currentValue !== lastInputValue) {
            lastInputValue = currentValue;
            
            if (currentValue === '') {
                // 如果输入框为空，取消任何待处理的翻译
                clearTranslationDelay();
                return;
            }
            
            // 检测是否有中文
            const hasChineseText = /[一-龥]/.test(currentValue);
            if (!hasChineseText) {
                // 如果没有中文，不启动翻译
                clearTranslationDelay();
                return;
            }
            
            // 启动延迟翻译
            startTranslationDelay();
        }
    });
    
    // 添加键盘快捷键
    input.addEventListener('keydown', function(e) {
        // 按下 Ctrl+Enter 立即翻译并填入
        if (e.key === 'Enter' && e.ctrlKey) {
            e.preventDefault();
            clearTranslationDelay(); // 取消任何待处理的翻译
            if (targetInputElement) {
                fillTranslationToTargetInput();
            } else {
                translate();
            }
        }
    });
    
    // 选择输入框功能
    selectInputBtn.addEventListener('click', function() {
        if (isSelectingInput) {
            // 取消选择模式
            isSelectingInput = false;
            selectInputBtn.textContent = '选择输入框';
            updateStatus('已取消选择模式');
            document.removeEventListener('click', inputSelectorClickHandler, true);
        } else {
            // 进入选择模式
            isSelectingInput = true;
            selectInputBtn.textContent = '取消选择';
            updateStatus('请点击页面上的输入框来选择目标');
            document.addEventListener('click', inputSelectorClickHandler, true);
        }
    });
    
    // 自动模式切换
    autoModeBtn.addEventListener('click', function() {
        isAutoMode = !isAutoMode;
        autoModeBtn.textContent = `自动模式: ${isAutoMode ? '开启' : '关闭'}`;
        updateStatus(isAutoMode ? '自动模式已开启' : '自动模式已关闭');
    });
    
    // 处理目标输入框选择
    function inputSelectorClickHandler(e) {
        e.preventDefault();
        e.stopPropagation();
        
        // 移除之前的高亮
        if (targetInputElement) {
            targetInputElement.classList.remove('active-element');
        }
        
        const element = e.target;
        
        // 扩展可输入元素的类型检查
        const isInputElement = element.tagName === 'INPUT' || element.tagName === 'TEXTAREA';
        const isContentEditable = element.isContentEditable || element.getAttribute('contenteditable') === 'true';
        const isRedditEditor = element.closest('[role="textbox"]') || element.closest('.public-DraftEditor-content') || element.getAttribute('role') === 'textbox';
        const isComplexEditor = element.classList.contains('editor') || element.classList.contains('ql-editor') || element.closest('.editor') || element.closest('.ql-editor');
        
        // 使用更宽泛的选择器来识别各种输入区域
        if (isInputElement || isContentEditable || isRedditEditor || isComplexEditor) {
            // 如果点击的是复杂编辑器内的元素，尝试找到其父容器
            if (isRedditEditor && !isInputElement && !isContentEditable) {
                targetInputElement = element.closest('[role="textbox"]') || element;
            } else if (isComplexEditor && !isInputElement && !isContentEditable) {
                targetInputElement = element.closest('.editor') || element.closest('.ql-editor') || element;
            } else {
                targetInputElement = element;
            }
            
            targetInputElement.classList.add('active-element');
            updateStatus(`已选择目标输入框: ${targetInputElement.tagName.toLowerCase()}${targetInputElement.id ? '#' + targetInputElement.id : ''}`);
            
            // 设置监听器
            setupTargetInputListener();
            
            // 为监听复杂编辑器，添加更多事件类型
            if (isRedditEditor || isComplexEditor || isContentEditable) {
                targetInputElement.addEventListener('keyup', function(e) {
                    // 延迟处理，以确保内容已更新
                    setTimeout(function() {
                        handleInputChange(targetInputElement);
                    }, 100);
                });
            }
        } else {
            updateStatus('所选元素不是有效的输入框，请重新选择');
        }
        
        // 退出选择模式
        isSelectingInput = false;
        selectInputBtn.textContent = '选择输入框';
        document.removeEventListener('click', inputSelectorClickHandler, true);
    }
    
    // 保存最后选择的输入框
    function saveLastSelectedElement() {
        // 这里仅保存一个标识，实际元素在页面刷新后会失效
        // 可以考虑保存xpath或选择器来在页面重新加载时尝试恢复
        if (targetInputElement) {
            const elementInfo = {
                tagName: targetInputElement.tagName,
                id: targetInputElement.id,
                name: targetInputElement.name,
                className: targetInputElement.className
            };
            GM_setValue('lastSelectedElement', JSON.stringify(elementInfo));
        }
    }
    
    // 尝试从保存的信息中恢复目标输入框
    function tryRestoreLastSelectedElement() {
        const savedInfo = GM_getValue('lastSelectedElement', null);
        if (!savedInfo) return false;
        
        try {
            const elementInfo = JSON.parse(savedInfo);
            let candidates = [];
            
            // 尝试按ID查找
            if (elementInfo.id) {
                const el = document.getElementById(elementInfo.id);
                if (el) candidates.push(el);
            }
            
            // 尝试按名称查找
            if (elementInfo.name) {
                const els = document.getElementsByName(elementInfo.name);
                if (els.length > 0) {
                    for (let el of els) {
                        candidates.push(el);
                    }
                }
            }
            
            // 尝试按标签和类名查找
            if (candidates.length === 0 && elementInfo.className) {
                const els = document.getElementsByClassName(elementInfo.className);
                if (els.length > 0) {
                    for (let el of els) {
                        if (el.tagName === elementInfo.tagName) {
                            candidates.push(el);
                        }
                    }
                }
            }
            
            // 使用第一个找到的元素
            if (candidates.length > 0) {
                targetInputElement = candidates[0];
                targetInputElement.classList.add('active-element');
                updateStatus(`已恢复目标输入框: ${targetInputElement.tagName.toLowerCase()}${targetInputElement.id ? '#' + targetInputElement.id : ''}`);
                
                // 为恢复的元素添加监听器
                setupTargetInputListener();
                return true;
            }
        } catch (error) {
            console.error('恢复目标输入框失败:', error);
        }
        
        return false;
    }
    
    // 设置目标输入框的监听器
    function setupTargetInputListener() {
        if (!targetInputElement) return;
        
        // 防止重复添加监听器
        targetInputElement.removeEventListener('input', targetInputChangeHandler);
        targetInputElement.addEventListener('input', targetInputChangeHandler);
        
        // 为不支持input事件的复杂编辑器添加监听
        if (targetInputElement.isContentEditable || targetInputElement.getAttribute('contenteditable') === 'true' || 
            targetInputElement.getAttribute('role') === 'textbox' ||
            targetInputElement.closest('[role="textbox"]')) {
            targetInputElement.removeEventListener('keyup', complexEditorChangeHandler);
            targetInputElement.addEventListener('keyup', complexEditorChangeHandler);
            
            // 添加鼠标事件以捕获粘贴等操作
            targetInputElement.removeEventListener('mouseup', complexEditorChangeHandler);
            targetInputElement.addEventListener('mouseup', complexEditorChangeHandler);
        }
    }
    
    // 复杂编辑器内容变化处理器
    function complexEditorChangeHandler(e) {
        // 延迟处理以确保内容已更新
        setTimeout(function() {
            handleInputChange(targetInputElement);
        }, 200);
    }
    
    // 获取元素内容的通用函数
    function getElementContent(element) {
        if (!element) return '';
        if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
            return element.value;
        } else if (element.isContentEditable || element.getAttribute('contenteditable') === 'true' || element.getAttribute('role') === 'textbox' || element.closest('[role="textbox"]')) {
            // For complex editors, innerText might be more appropriate than textContent to get visible text
            return element.innerText || element.textContent || '';
        }
        return '';
    }
    
    // 设置元素内容的通用函数 (Modified)
    function setElementContent(element, content) {
        if (!element) return;
        element.focus(); 

        if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
            element.value = content; 
        } else if (element.isContentEditable || element.getAttribute('contenteditable') === 'true' || element.getAttribute('role') === 'textbox' || element.closest('[role="textbox"]')) {
            simulateTyping(element, content); 
        } else {
            console.warn('setElementContent: Trying to set content on an unhandled element type. Using textContent.', element);
            element.textContent = content;
        }

        element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    }
    
    // 模拟逐字输入以更好地与复杂编辑器兼容 (Modified)
    function simulateTyping(element, text) {
        if (!element) return;
        element.focus();
        
        // 改进清空方式 for contenteditable elements
        if (element.isContentEditable || element.getAttribute('contenteditable') === 'true' || element.getAttribute('role') === 'textbox' || element.closest('[role="textbox"]')) {
            document.execCommand('selectAll', false, null);
            document.execCommand('delete', false, null);
            // Fallback clear if execCommand was not fully effective or if content remains
            if (getElementContent(element).trim() !== '') {
                element.textContent = ''; 
                 if (element.innerHTML && typeof element.innerHTML === 'string') element.innerHTML = '';
            }
        } else if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
            // This case should ideally be handled by setElementContent directly setting .value
            // but if called, clear the value.
            element.value = '';
        }
        
        element.focus(); // Re-focus after clearing
        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            document.execCommand('insertText', false, char);
        }
    }
    
    // 统一处理输入变化
    function handleInputChange(element) {
        if (!isAutoMode || !element) return;
        
        const content = getElementContent(element);
        if (content && content.trim() !== '') {
            // 检测是否为中文输入
            const isChineseText = /[一-龥]/.test(content);
            if (isChineseText) {
                // 更新主输入框内容
                input.value = content;
                // Check if input.value was actually set, then update lastInputValue
                if (input.value === content) {
                    lastInputValue = content;
                } else { // If input.value could not be set (e.g. readonly), log or handle
                    console.warn("handleInputChange: input.value could not be set to target's content");
                    lastInputValue = input.value; // Sync with what could be set
                }
                
                // 启动延迟
                startTranslationDelay();
            }
        }
    }
    
    // 目标输入框内容变化处理器
    function targetInputChangeHandler() {
        if (targetInputElement) {
            handleInputChange(targetInputElement);
        }
    }
    
    // 添加键盘快捷键全局支持
    document.addEventListener('keydown', function(e) {
        // Alt+T 快捷键显示/隐藏翻译器
        if (e.key === 't' && e.altKey) {
            e.preventDefault();
            translator.style.display = translator.style.display === 'none' ? 'flex' : 'none';
            updateStatus(translator.style.display === 'none' ? '翻译器已隐藏' : '翻译器已显示');
        }
        
        // Alt+S 快捷键开始选择输入框
        if (e.key === 's' && e.altKey) {
            e.preventDefault();
            if (!isSelectingInput) {
                isSelectingInput = true;
                selectInputBtn.textContent = '取消选择';
                updateStatus('请点击页面上的输入框来选择目标');
                document.addEventListener('click', inputSelectorClickHandler, true);
            } else {
                isSelectingInput = false;
                selectInputBtn.textContent = '选择输入框';
                updateStatus('已取消选择模式');
                document.removeEventListener('click', inputSelectorClickHandler, true);
            }
        }
        
        // Alt+A 快捷键切换自动模式
        if (e.key === 'a' && e.altKey) {
            e.preventDefault();
            isAutoMode = !isAutoMode;
            autoModeBtn.textContent = `自动模式: ${isAutoMode ? '开启' : '关闭'}`;
            updateStatus(isAutoMode ? '自动模式已开启' : '自动模式已关闭');
        }
    });
    
    // 添加右键菜单提示
    translator.addEventListener('contextmenu', function(e) {
        e.preventDefault();
        const shortcutsMsg = `
            快捷键说明:
            - Alt+T: 显示/隐藏翻译器
            - Alt+S: 开始选择输入框
            - Alt+A: 切换自动模式
            - Ctrl+Enter (在翻译器输入框内): 立即翻译并填充选中框
        `;
        alert(shortcutsMsg);
    });
    
    // 检测特殊网站并提供更好的兼容性
    function detectSiteAndOptimize() {
        const hostname = window.location.hostname;
        
        if (hostname.includes('reddit.com')) {
            updateStatus('检测到 Reddit 网站，已启用特殊兼容模式');
            // Reddit specific observer logic (can be enhanced)
            const redditObserver = new MutationObserver(function(mutations) {
                mutations.forEach(function(mutation) {
                    if (targetInputElement && isAutoMode && document.contains(targetInputElement)) {
                         // Check if the mutation target is the input element or its child
                        if (mutation.target === targetInputElement || targetInputElement.contains(mutation.target)) {
                           handleInputChange(targetInputElement);
                        }
                    }
                });
            });
            
            // Re-apply observer if targetInputElement changes or is restored
            const reapplyObserver = () => {
                if (targetInputElement && document.contains(targetInputElement)) { // Ensure element is still in DOM
                    redditObserver.disconnect(); // Disconnect previous if any
                    redditObserver.observe(targetInputElement, { 
                        childList: true, 
                        characterData: true,
                        subtree: true, // Observe subtree for changes within complex editors
                        // characterDataOldValue: true // Not always needed and can be verbose
                    });
                }
            };

            // Initial application if targetInputElement is already set
            reapplyObserver();
            // Hook into target input selection/restoration to reapply observer
            const originalInputSelectorClickHandler = inputSelectorClickHandler;
            inputSelectorClickHandler = function(...args) {
                originalInputSelectorClickHandler.apply(this, args);
                if (hostname.includes('reddit.com')) reapplyObserver();
            };
            const originalTryRestoreLastSelectedElement = tryRestoreLastSelectedElement;
            tryRestoreLastSelectedElement = function(...args) {
                const result = originalTryRestoreLastSelectedElement.apply(this, args);
                if (result && hostname.includes('reddit.com')) reapplyObserver();
                return result;
            };
        }
    }
    
    // 运行网站检测
    detectSiteAndOptimize();
    
    // 尝试恢复上次选择的输入框
    tryRestoreLastSelectedElement(); // This might now re-apply observer if on reddit
    
    // 保存输入框选择，页面关闭前自动保存
    window.addEventListener('beforeunload', saveLastSelectedElement);
})();
