// src/renderer/js/core/ui.js
import { resetProjectState } from './state.js';
import { totalFiles, currentFilesData, totalApiLogEntries, resetApiState } from './api.js';

// DOM Elements
const toastMessage = document.getElementById('toast-message');
export const loader = document.getElementById('loader');

/**
 * Displays a toast message at the bottom of the screen.
 * @param {string} message The message to display.
 * @param {'success'|'error'|'info'} type The type of toast.
 * @param {number} duration The duration in milliseconds.
 */
export function showToast(message, type = 'success', duration = 3000) {
    if (!toastMessage) return;
    
    toastMessage.textContent = message;
    toastMessage.className = 'hidden'; // Start with hidden to reset classes
    toastMessage.classList.add(
        'fixed', 'bottom-5', 'left-1/2', 'transform', '-translate-x-1/2', 
        'px-6', 'py-3', 'rounded-md', 'font-medium', 'shadow-lg', 'z-50', 
        'transition-all', 'duration-300', 'ease-in-out'
    );

    const typeClasses = {
        success: 'bg-green-500 text-white',
        error: 'bg-red-500 text-white',
        warning: 'bg-yellow-500 text-white',
        info: 'bg-blue-500 text-white'
    };
    
    toastMessage.classList.add(...(typeClasses[type] || typeClasses['info']).split(' '));
    
    toastMessage.classList.remove('hidden');
    toastMessage.style.opacity = 1;
    toastMessage.style.transform = 'translateX(-50%) translateY(0)';
    
    setTimeout(() => {
        toastMessage.style.opacity = 0;
        toastMessage.style.transform = 'translateX(-50%) translateY(20px)';
        setTimeout(() => toastMessage.classList.add('hidden'), 300);
    }, duration);
}

/**
 * Resets the entire application display to its initial, "no project loaded" state.
 * This function is self-contained and directly manipulates the DOM.
 */
export function resetDisplay() {
    console.log("[Renderer] Resetting display state and UI.");
    
    // 1. Reset the core application state (hdpcPath, projectId, cache)
    resetProjectState();
    
    // 2. Reset API-level state variables
    resetApiState();

    // 3. Reset all text content and counters to '0' or empty
    const elementsToClearText = [
        'overviewProjectName', 'overviewSchemaVersion', 'overviewDescription', 
        'metadataTitle', 'metadataDescription', 'metadataDoi', 'metadataStatus', 
        'metadataVersion', 'fileCount', 'batchCount', 'mappingCount', 
        'apiLogCount', 'credentialCount', 'hdpcConfig'
    ];
    elementsToClearText.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            if (el.tagName === 'SPAN' || el.tagName === 'DIV' || id.includes('Count')) {
                el.textContent = '0';
            } else {
                el.textContent = '';
            }
        }
    });

    // 4. Clear the inner HTML of all list containers
    const elementsToClearHtml = [
        'metadataCreators', 'metadataKeywords', 'metadataFiles', 'pipelineSteps', 
        'batchesList', 'mappingsList', 'apiLogList', 'credentialsList', 
        'operabilityTestsList'
    ];
    elementsToClearHtml.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = '';
    });

    // 5. Reset input fields
    const fileSearchInput = document.getElementById('fileSearchInput');
    if (fileSearchInput) fileSearchInput.value = '';
    
    const fileNameDisplay = document.getElementById('fileName');
    if (fileNameDisplay) fileNameDisplay.textContent = 'No project loaded';

    // 6. Show all "no data" messages
    const messageElementsToShow = [
        'noZenodoRecordMessage', 'noFilesMessage', 'noPipelineMessage', 'noConfigMessage', 
        'noBatchesMessage', 'noMappingsMessage', 'noApiLogMessage', 'noCredentialsMessage', 
        'noOperabilityTestsMessage'
    ];
    messageElementsToShow.forEach(id => { 
        const el = document.getElementById(id); 
        if (el) el.style.display = 'block'; 
    });

    // 7. Hide pagination controls
    const paginationControlsToHide = ['filesPaginationControls', 'apiLogPaginationControls'];
    paginationControlsToHide.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });

    // 8. Toggle visibility of main content containers
    const hdpcContentsDisplay = document.getElementById('hdpcContentsDisplay');
    if (hdpcContentsDisplay) hdpcContentsDisplay.classList.add('hidden');
    
    const noFileLoaded = document.getElementById('noFileLoaded');
    if (noFileLoaded) noFileLoaded.classList.remove('hidden');
}

/**
 * Sets up event listeners to close any modal by clicking on its backdrop.
 */
export function setupModalBackdropClosers() {
    const modalBackdrops = document.querySelectorAll('.js-modal-backdrop');
    modalBackdrops.forEach(modal => {
        modal.addEventListener('click', (event) => {
            // Only close if the click is on the backdrop itself, not a child element
            if (event.target === modal) {
                modal.classList.add('hidden');
            }
        });
    });
}