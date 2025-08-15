// src/renderer/js/views/models.js

import { showToast } from '../core/ui.js';
import { mainAppConfigCache, mainAppConfigDirAbsPath } from '../core/state.js';
import { addToLog } from '../renderer.js';

// --- DOM Elements ---
const modelsBtn = document.getElementById('modelsBtn');
const modelsModal = document.getElementById('modelsModal');
const closeModelsModalBtn = document.getElementById('closeModelsModalBtn');
const closeModelsModalFooterBtn = document.getElementById('closeModelsModalFooterBtn');
const modelsPathInstructionEl = document.getElementById('modelsPathInstruction');
const downloadableModelsListEl = document.getElementById('downloadableModelsList');

// --- Constants ---
const PREDEFINED_MODELS = [
    {
        id: "yolov10x",
        name: "YOLOv10x Object Detection Model",
        filename: "yolov10x.pt",
        url: "https://github.com/ultralytics/assets/releases/download/v8.3.0/yolov10x.pt",
        description: "A powerful real-time object detection model (YOLOv10, X-large variant)."
    },
    {
        id: "sam_vit_h",
        name: "Segment Anything Model (ViT-H)",
        filename: "sam_vit_h_4b8939.pth",
        url: "https://dl.fbaipublicfiles.com/segment_anything/sam_vit_h_4b8939.pth",
        description: "Segment Anything Model (SAM) using a Vision Transformer (Huge variant)."
    }
];

// --- Core Functions ---

/**
 * Opens the models modal and populates it with information about the configured models path.
 */
async function openModelsModal() {
    if (!mainAppConfigCache || Object.keys(mainAppConfigCache).length === 0) {
        showToast("Main application configuration not loaded. Please try again or restart.", "error");
        return;
    }

    const modelsPathRelative = mainAppConfigCache.paths?.models;
    if (!modelsPathInstructionEl) {
        console.error("modelsPathInstructionEl not found");
        return;
    }

    if (!modelsPathRelative) {
        modelsPathInstructionEl.innerHTML = `
            <p class="text-red-600 font-semibold">Models directory not configured!</p>
            <p>Please set the 'paths.models' directory in the main application Settings first.</p>`;
        downloadableModelsListEl.innerHTML = '';
    } else {
        modelsPathInstructionEl.innerHTML = `
            <p>Models will be downloaded into the directory specified in your settings:</p>
            <p class="font-mono bg-gray-100 p-2 rounded my-1 text-sm break-all">${modelsPathRelative}</p>
            <p class="text-xs text-gray-500">Note: Relative paths are resolved from your main <code>config.yaml</code> directory: ${mainAppConfigDirAbsPath || 'N/A'}</p>`;
        renderDownloadableModels();
    }

    if (modelsModal) modelsModal.classList.remove('hidden');
}

/**
 * Renders the list of predefined downloadable models, checking their status.
 */
async function renderDownloadableModels() {
    if (!downloadableModelsListEl) return;
    downloadableModelsListEl.innerHTML = '<div class="text-center text-gray-500 py-4">Loading model statuses...</div>';

    const configuredModelsPath = mainAppConfigCache?.paths?.models;
    if (!configuredModelsPath) {
        downloadableModelsListEl.innerHTML = '<p class="text-center text-red-500 p-4">Models directory not configured in settings.</p>';
        return;
    }

    let modelsHtmlContent = '';
    for (const model of PREDEFINED_MODELS) {
        let fileExists = false;
        let checkedPathDisplay = "";

        if (window.electronAPI?.checkModelFileExists) {
            try {
                const result = await window.electronAPI.checkModelFileExists({
                    configuredModelsPath: configuredModelsPath,
                    filename: model.filename
                });
                fileExists = result.exists;
                checkedPathDisplay = result.checkedPath ? `<p class="text-xs text-gray-400 mt-1">Checked: ${result.checkedPath}</p>` : '';
            } catch (error) {
                checkedPathDisplay = `<p class="text-xs text-red-400 mt-1">Error checking file status.</p>`;
            }
        }

        const buttonHtml = fileExists
            ? `<button disabled class="btn-success text-sm opacity-75 cursor-default flex items-center">
                   <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-5 h-5 mr-2"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16Zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.06 0l4.073-5.573Z" clip-rule="evenodd" /></svg>
                   Downloaded
               </button>`
            : `<button data-url="${model.url}" data-filename="${model.filename}" data-model-id="${model.id}"
                       class="download-model-btn btn-primary text-sm flex items-center">
                   <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-5 h-5 mr-2"><path d="M10.75 2.75a.75.75 0 00-1.5 0v8.614L6.295 8.235a.75.75 0 10-1.09 1.03l4.25 4.5a.75.75 0 001.09 0l4.25-4.5a.75.75 0 00-1.09-1.03l-2.955 3.129V2.75Z" /><path d="M3.5 12.75a.75.75 0 00-1.5 0v2.5A2.75 2.75 0 004.75 18h10.5A2.75 2.75 0 0018 15.25v-2.5a.75.75 0 00-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5Z" /></svg>
                   Download
               </button>`;

        modelsHtmlContent += `
            <div id="model-item-${model.id}" class="p-4 border rounded-lg bg-white shadow-sm">
                <h4 class="text-lg font-semibold text-gray-800">${model.name}</h4>
                <p class="text-xs text-gray-500 mb-1">Filename: <code class="bg-gray-100 p-1 rounded text-xs">${model.filename}</code></p>
                <p class="text-sm text-gray-600 mb-3">${model.description}</p>
                <div class="flex items-center space-x-3">
                    ${buttonHtml}
                    <div id="progress-bar-container-${model.id}" class="flex-grow bg-gray-200 rounded-full h-6 hidden">
                        <div id="progress-bar-${model.id}" class="bg-green-500 h-6 rounded-full text-xs font-medium text-white text-center p-0.5 leading-none" style="width: 0%;">0%</div>
                    </div>
                </div>
                <p id="status-message-${model.id}" class="text-xs mt-2 ${fileExists ? 'text-green-700 font-medium' : 'text-gray-500'}">
                    ${fileExists ? 'Model is present in the models directory.' : ''}
                </p>
                ${checkedPathDisplay}
            </div>`;
    }

    downloadableModelsListEl.innerHTML = modelsHtmlContent;
    downloadableModelsListEl.querySelectorAll('.download-model-btn').forEach(button => {
        button.addEventListener('click', handleModelDownloadClick);
    });
}

/**
 * Handles the click event for a model download button.
 */
async function handleModelDownloadClick(event) {
    const button = event.currentTarget;
    const { url, filename, modelId } = button.dataset;
    const configuredModelsPath = mainAppConfigCache?.paths?.models;

    if (!configuredModelsPath) {
        showToast("Models directory not configured in settings!", "error");
        return;
    }

    if (!confirm(`Download '${filename}' to your configured models directory?`)) {
        showToast("Download cancelled.", "info");
        return;
    }

    button.disabled = true;
    button.textContent = "Downloading...";
    const progressBarContainer = document.getElementById(`progress-bar-container-${modelId}`);
    const statusMessage = document.getElementById(`status-message-${modelId}`);
    if (progressBarContainer) progressBarContainer.classList.remove('hidden');
    if (statusMessage) statusMessage.textContent = 'Starting download...';

    try {
        const result = await window.electronAPI.downloadModelFile({
            downloadUrl: url,
            configuredModelsPath,
            filename
        });
        if (!result.success) {
            throw new Error(result.error || "Failed to start download.");
        }
        // Progress and completion are handled by IPC listeners.
    } catch (error) {
        if (statusMessage) statusMessage.textContent = `Error: ${error.message}`;
        showToast(`Download error: ${error.message}`, "error");
        button.disabled = false;
        button.textContent = "Download";
        if (progressBarContainer) progressBarContainer.classList.add('hidden');
        addToLog('Model Download', `Error initiating download for ${filename}: ${error.message}`);
    }
}

/**
 * Sets up IPC listeners for model download progress and completion events from the main process.
 */
function setupModelDownloadListeners() {
    if (window.electronAPI?.onModelDownloadProgress) {
        window.electronAPI.onModelDownloadProgress(({ filename, progressPercent }) => {
            const model = PREDEFINED_MODELS.find(m => m.filename === filename);
            if (!model) return;
            const progressBar = document.getElementById(`progress-bar-${model.id}`);
            if (progressBar) {
                progressBar.style.width = `${progressPercent}%`;
                progressBar.textContent = `${progressPercent}%`;
            }
        });
    }

    if (window.electronAPI?.onModelDownloadComplete) {
        window.electronAPI.onModelDownloadComplete(({ filename, success, path, error, message }) => {
            const model = PREDEFINED_MODELS.find(m => m.filename === filename);
            if (!model) return;

            if (success) {
                showToast(message || `${filename} downloaded successfully!`, "success");
                // Refresh the modal content to show the "Downloaded" state.
                renderDownloadableModels();
            } else {
                showToast(error || message || `Failed to download ${filename}.`, "error");
                // Also refresh to reset the button state.
                renderDownloadableModels();
            }
        });
    }
}


// --- Initialization ---
export function initModels() {
    if (modelsBtn) modelsBtn.addEventListener('click', openModelsModal);
    if (closeModelsModalBtn) closeModelsModalBtn.addEventListener('click', () => modelsModal.classList.add('hidden'));
    if (closeModelsModalFooterBtn) closeModelsModalFooterBtn.addEventListener('click', () => modelsModal.classList.add('hidden'));

    // Set up the global IPC listeners once the module is initialized.
    setupModelDownloadListeners();
}