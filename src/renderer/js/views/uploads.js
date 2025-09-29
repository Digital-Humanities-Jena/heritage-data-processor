// src/renderer/js/views/uploads.js
import { PYTHON_API_BASE_URL, backendAddSourceFiles } from '../core/api.js';
import { currentlyLoadedHdpcPath, appDataCache, mainAppConfigCache, isProjectLoaded, ensureZenodoSchema, clearZenodoSchemaCache } from '../core/state.js';
import { showToast, loader } from '../core/ui.js';
import { navigateToView } from '../core/navigation.js';

// --- DOM Elements ---
// Main View & Tabs
const uploadsEnvToggleEl = document.getElementById('uploadsEnvToggle');
const productionWarningEl = document.getElementById('productionWarning');
const refreshUploadsViewBtn = document.getElementById('refreshUploadsViewBtn');
const uploadsTabBtns = document.querySelectorAll('.uploads-tab-btn');
const uploadsTabPanes = document.querySelectorAll('.uploads-tab-pane');
const noUploadsMessageEl = document.getElementById('noUploadsMessage');
const pendingPrepCountEl = document.getElementById('pendingPrepCount');
const pendingOpsCountEl = document.getElementById('pendingOpsCount');
const draftsCountEl = document.getElementById('draftsCount');
const publishedCountEl = document.getElementById('publishedCount');
const versioningCountEl = document.getElementById('versioningCount');
const uploadsViewAddFilesBtn = document.getElementById('uploadsViewAddFilesBtn');
const uploadsViewAddDirectoryBtn = document.getElementById('uploadsViewAddDirectoryBtn');

// Batch Actions
const uploadsBatchActionsContainerEl = document.getElementById('uploadsBatchActionsContainer');
const selectAllItemsCheckboxEl = document.getElementById('selectAllItemsCheckbox');
const uploadsBatchActionDropdownEl = document.getElementById('uploadsBatchActionDropdown');
const executeBatchActionBtnEl = document.getElementById('executeBatchActionBtn');
const selectedItemsCountEl = document.getElementById('selectedItemsCount');

// Progress Modal
const uploadProgressModalEl = document.getElementById('uploadProgressModal');
const closeUploadProgressModalBtnEl = document.getElementById('closeUploadProgressModalBtn');
const uploadProgressTitleEl = document.getElementById('uploadProgressTitle');
const uploadProgressStatusEl = document.getElementById('uploadProgressStatus');
const uploadProgressBarEl = document.getElementById('uploadProgressBar');
const uploadProgressPercentageEl = document.getElementById('uploadProgressPercentage');
const uploadProgressLogEl = document.getElementById('uploadProgressLog');

// Edit Metadata Modal
const editMetadataModal = document.getElementById('editMetadataModal');
const editMetadataModalTitle = document.getElementById('editMetadataModalTitle');
const editMetadataModalBody = document.getElementById('editMetadataModalBody');
const closeEditMetadataModalBtn = document.getElementById('closeEditMetadataModalBtn');
const cancelEditMetadataBtn = document.getElementById('cancelEditMetadataBtn');
const saveAndPrepareMetadataBtn = document.getElementById('saveAndPrepareMetadataBtn');

// Pipeline Integration
const pipelineSelectionSection = document.getElementById('pipelineSelectionSection');
const pipelineDropdown = document.getElementById('pipelineDropdown');
const viewInConstructorBtn = document.getElementById('viewInConstructorBtn');
const initiatePipelineExecutionBtn = document.getElementById('initiatePipelineExecutionBtn');
const pipelineExecutionModal = document.getElementById('pipelineExecutionModal');

// New Versions Pipeline Modal
const newVersionFromFileModal = document.getElementById('newVersionFromFileModal');
const closeNewVersionFromFileModal = document.getElementById('closeNewVersionFromFileModal');
const newVersionDirectoryPath = document.getElementById('newVersionDirectoryPath');
const browseNewVersionDirectoryBtn = document.getElementById('browseNewVersionDirectoryBtn');
const processingModeRoot = document.getElementById('processingModeRoot');
const processingModeSubdirectory = document.getElementById('processingModeSubdirectory');
const rootOptionsContainer = document.getElementById('rootOptionsContainer');
const subdirectoryMessage = document.getElementById('subdirectoryMessage');
const scanFilesForMatchesBtn = document.getElementById('scanFilesForMatchesBtn');
const backToStep1Btn = document.getElementById('backToStep1Btn');
const proceedToVersioningBtn = document.getElementById('proceedToVersioningBtn');
const newVersionFromFileStep1 = document.getElementById('newVersionFromFileStep1');
const newVersionFromFileStep2 = document.getElementById('newVersionFromFileStep2');
const matchedRecordsContainer = document.getElementById('matchedRecordsContainer');

// --- Module State ---
let currentUploadsTab = 'pending_preparation';
let selectedUploadItems = new Set();
let availablePipelines = [];
let currentPendingOperationsRecords = [];
let currentPublishedRecords = [];
let currentItemsInView = [];
let fileBundleCache = {};

// --- Main View & Tab Logic ---

export async function refreshUploadsView() {
    const activeTab = document.querySelector('.uploads-tab-btn.border-blue-600');
    if (!activeTab) {
        console.warn("No active uploads tab found to refresh.");
        await updateAllUploadsTabCounts();
        return;
    }
    
    const activeTabContent = document.getElementById(`uploadsTabContent_${activeTab.dataset.tabId}`);
    if(activeTabContent) activeTabContent.innerHTML = '<p class="text-gray-500 p-4">Refreshing...</p>';

    await loadUploadsTabContent(); 
    await updateAllUploadsTabCounts();
    console.log("Uploads view refreshed.");
}

async function updateAllUploadsTabCounts() {
    const isSandbox = uploadsEnvToggleEl.value === 'sandbox';
    const counts = { pending_preparation: 0, pending_operations: 0, drafts: 0, published: 0, versioning: 0 };

    try {
        if (!isProjectLoaded()) return;
        const response = await fetch(`${PYTHON_API_BASE_URL}/api/project/uploads_tab_counts?hdpcPath=${encodeURIComponent(currentlyLoadedHdpcPath)}&is_sandbox=${isSandbox}`);
        if (response.ok) {
            Object.assign(counts, await response.json());
        }
    } catch (error) {
        console.error("Error fetching tab counts:", error);
    }

    pendingPrepCountEl.textContent = counts.pending_preparation;
    pendingOpsCountEl.textContent = counts.pending_operations;
    draftsCountEl.textContent = counts.drafts;
    publishedCountEl.textContent = counts.published;
    versioningCountEl.textContent = counts.versioning;
}

async function loadUploadsTabContent() {
    if (!isProjectLoaded()) {
        if (noUploadsMessageEl) {
            noUploadsMessageEl.textContent = 'Load a HDPC project to view uploads.';
            noUploadsMessageEl.classList.remove('hidden');
        }
        uploadsTabPanes.forEach(pane => pane.innerHTML = '');
        if(uploadsBatchActionsContainerEl) uploadsBatchActionsContainerEl.classList.add('hidden');
        return;
    }

    if (loader) loader.style.display = 'block';
    const isSandboxForView = uploadsEnvToggleEl.value === 'sandbox';
    
    const activePane = document.getElementById(`uploadsTabContent_${currentUploadsTab}`);
    if (activePane) activePane.innerHTML = '<p class="text-center text-gray-500 py-4">Loading items...</p>';
    if (noUploadsMessageEl) noUploadsMessageEl.classList.add('hidden');
    
    selectedUploadItems.clear();
    currentItemsInView = []; // Reset current items before fetch
    updateBatchActionUI(); // Reset UI based on cleared state

    try {
        const response = await fetch(`${PYTHON_API_BASE_URL}/api/project/uploads_by_tab?hdpcPath=${encodeURIComponent(currentlyLoadedHdpcPath)}&tab_id=${currentUploadsTab}&is_sandbox=${isSandboxForView}`);
        const items = await response.json();
        if (!response.ok) throw new Error(items.error || 'Server error');
        
        currentItemsInView = items; // Store fetched items in module state

        if (activePane) renderItemsForTab(items, activePane);

        // Load pipelines if on the pending ops or published tab
        if (currentUploadsTab === 'pending_operations' || currentUploadsTab === 'published') {
            await loadPipelinesForUploads();
            // Show the appropriate pipeline section based on the tab
            showPipelineSelectionSection(currentUploadsTab === 'pending_operations');
        } else {
            showPipelineSelectionSection(false);
        }
    } catch (error) {
        console.error(`Error loading content for tab ${currentUploadsTab}:`, error);
        if (activePane) activePane.innerHTML = `<p class="text-red-500 p-3">Error loading data: ${error.message}</p>`;
    } finally {
        if (loader) loader.style.display = 'none';
    }
}

function renderItemsForTab(items, paneEl) {
    if (items.length === 0) {
        paneEl.innerHTML = '';
        if (noUploadsMessageEl) {
            noUploadsMessageEl.innerHTML = `<p class="text-gray-600">No items found for this tab.</p>`;
            noUploadsMessageEl.classList.remove('hidden');
        }
        updateBatchActionUI();
        return;
    }
    
    if (noUploadsMessageEl) noUploadsMessageEl.classList.add('hidden');
    
    if (currentUploadsTab !== 'published' && uploadsBatchActionsContainerEl) {
        uploadsBatchActionsContainerEl.classList.remove('hidden');
        populateBatchActionDropdown();
    }

    if (currentUploadsTab === 'pending_operations') {
        currentPendingOperationsRecords = items;
    }
    
    if (currentUploadsTab === 'published') {
        currentPublishedRecords = items; // Store for filtering

        // This section is now always visible for the 'published' tab
        const newVersionSection = document.getElementById('newVersionPipelineSection');
        if (newVersionSection) {
            newVersionSection.classList.remove('hidden');
        }
        const initiateNewVersionBtn = document.getElementById('initiateNewVersionBtn');
        if (initiateNewVersionBtn) {
            initiateNewVersionBtn.disabled = false; // Always enabled
            initiateNewVersionBtn.textContent = 'Create New Version from Files...';
        }

        const concepts = items.reduce((acc, item) => {
            const conceptId = item.concept_rec_id || `no-concept-${item.local_record_db_id}`;
            if (!acc[conceptId]) {
                acc[conceptId] = {
                    title: item.record_title,
                    items: []
                };
            }
            acc[conceptId].items.push(item);
            return acc;
        }, {});

        if (Object.keys(concepts).length === 0) {
             paneEl.innerHTML = '<p class="text-center text-gray-500 p-4">No published records found in this environment.</p>';
             return;
        }

        paneEl.innerHTML = Object.entries(concepts).map(([conceptId, conceptGroup]) => {
            const latestVersion = conceptGroup.items[0];

            const versionsHtml = conceptGroup.items.map(item => `
                <div class="flex items-center justify-between p-2 bg-gray-50 border-t">
                    <div class="text-xs">
                        <span class="font-semibold text-gray-700">Version ${item.version || 'N/A'}</span>
                        <span class="text-gray-500 ml-2">DOI:</span>
                        ${item.zenodo_doi ? `<a href="${item.is_sandbox ? 'https://zenodo.org/records/' : 'https://sandbox.zenodo.org/records/'}${item.zenodo_api_deposition_id}" target="_blank" class="text-blue-600 hover:underline">${item.zenodo_doi}</a>` : 'N/A'}
                    </div>
                    <a href="${item.is_sandbox ? 'https://zenodo.org/deposit/' : 'https://sandbox.zenodo.org/deposit/'}${item.zenodo_api_deposition_id}" target="_blank" class="btn-secondary text-xs py-1 px-2">View on Zenodo</a>
                </div>
            `).join('');

            return `
                <div class="concept-group bg-white rounded-md border border-gray-200 shadow-sm overflow-hidden">
                    <div class="p-3 flex items-center justify-between">
                        <div>
                            <p class="font-semibold text-gray-800 text-sm truncate" title="${latestVersion.record_title}">${latestVersion.record_title}</p>
                            <p class="text-xs text-gray-500">Concept ID: ${conceptId.startsWith('no-concept') ? 'N/A' : conceptId}</p>
                        </div>
                        </div>
                    <div class="versions-list">${versionsHtml}</div>
                </div>
            `;
        }).join('');
    } else {
        paneEl.innerHTML = items.map(item => {
            const itemId = item.local_record_db_id || item.source_file_db_id; 
            let checkboxHtml = '';

            if (currentUploadsTab !== 'published' && itemId) {
                checkboxHtml = `<input type="checkbox" class="item-select-checkbox mt-1 h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500" data-id="${itemId}" data-item-type="${currentUploadsTab}">`;
            }

            if (currentUploadsTab === 'pending_preparation') {
                const totalFiles = item.total_bundle_files || 1;
                const bundleBtnHtml = totalFiles > 1 
                    ? `<button data-source-file-id="${item.source_file_db_id}" data-filename="${item.filename}" class="view-file-bundle-btn btn-secondary text-xs py-1 px-2">View Bundle (${totalFiles})</button>`
                    : '';

                return `<div class="upload-item p-3 bg-white rounded-md border border-gray-200 shadow-sm flex items-start space-x-3" data-item-id="${item.source_file_db_id}">
                            ${checkboxHtml}
                            <div class="flex-grow min-w-0">
                                <p class="font-semibold text-gray-800 text-sm truncate" title="${item.absolute_path}">${item.filename}</p>
                                <p class="text-xs text-gray-500">DB ID: ${item.source_file_db_id} | Status: <span class="font-medium">${item.file_db_status || 'N/A'}</span></p>
                            </div>
                            <div class="flex-shrink-0 space-x-1">
                                ${bundleBtnHtml}
                                <button data-source-file-id="${item.source_file_db_id}" class="edit-metadata-btn btn-secondary text-xs py-1 px-2">Edit</button>
                                <button data-source-file-id="${item.source_file_db_id}" data-filename="${item.filename}" class="prepare-metadata-btn btn-primary text-xs py-1 px-2">Prepare Metadata</button>
                            </div>
                        </div>`;
            } else if (currentUploadsTab === 'pending_operations') {
                return `<div class="upload-item p-3 bg-white rounded-md border border-gray-200 shadow-sm flex items-start space-x-3" data-item-id="${item.local_record_db_id}">
                            ${checkboxHtml}
                            <div class="flex-grow min-w-0">
                                <p class="font-semibold text-gray-800 text-sm truncate" title="Source File: ${item.filename}">${item.record_title || 'Untitled Prepared Record'}</p>
                                <p class="text-xs text-gray-500">Record DB ID: ${item.local_record_db_id} | Env: <span class="font-medium ${item.is_sandbox ? 'text-green-700' : 'text-red-700'}">${item.is_sandbox ? "Sandbox" : "Prod"}</span></p>
                            </div>
                            <div class="flex-shrink-0 space-x-1">
                                <button data-local-record-id="${item.local_record_db_id}" class="create-api-draft-btn btn-primary text-xs py-1 px-2">Create Zenodo Draft</button>
                            </div>
                        </div>`;
            } else if (currentUploadsTab === 'drafts') {
                const canPublish = item.uploaded_files_in_record === item.total_files_in_record && item.total_files_in_record > 0;
                return `<div class="upload-item p-3 bg-white rounded-md border border-gray-200 shadow-sm flex items-start space-x-3" data-item-id="${item.local_record_db_id}">
                            ${checkboxHtml}
                            <div class="flex-grow min-w-0">
                                <p class="font-semibold text-gray-800 text-sm truncate" title="Source: ${item.filename}">${item.record_title || 'Untitled Record'}</p>
                                <p class="text-xs text-gray-500">Zenodo ID: ${item.zenodo_api_deposition_id ? `<a href="${item.is_sandbox ? 'https://sandbox.zenodo.org/deposit/' : 'https://zenodo.org/deposit/'}${item.zenodo_api_deposition_id}" target="_blank" class="text-blue-600 hover:underline">${item.zenodo_api_deposition_id}</a>` : 'N/A'}</p>
                                <button data-record-id="${item.local_record_db_id}" class="view-draft-files-btn text-xs text-blue-600 hover:underline hover:text-blue-800 focus:outline-none">
                                    ${item.uploaded_files_in_record || 0} / ${item.total_files_in_record || 0} files uploaded
                                </button>
                            </div>
                            <div class="flex-shrink-0 space-x-1">
                                <button data-record-id="${item.local_record_db_id}" class="upload-to-zenodo-btn btn-secondary text-xs py-1 px-2">Upload Files</button>
                                <button data-record-id="${item.local_record_db_id}" class="publish-on-zenodo-btn btn-success text-xs py-1 px-2" ${!canPublish ? 'disabled title="All files must be uploaded"' : ''}>Publish</button>
                                <button data-local-record-id="${item.local_record_db_id}" class="discard-draft-btn btn-danger text-xs py-1 px-2">Discard</button>
                            </div>
                        </div>`;
            } else if (currentUploadsTab === 'versioning') {
                // Add case for the new tab
                paneEl.innerHTML = `
                    <div class="text-center p-8 bg-gray-50 rounded-lg">
                        <h3 class="text-lg font-medium text-gray-700">Versioning Workspace</h3>
                        <p class="mt-2 text-sm text-gray-500">
                            To start, go to the "Published" tab and click "Create New Version" on a record set. This area will then be used to manage the new draft version.
                        </p>
                    </div>
                `;
            }
            return '';
        }).join('');
    }

    attachUploadsEventListeners(paneEl);
    updateBatchActionUI();
}

function attachUploadsEventListeners(paneEl) {
    paneEl.querySelectorAll('.prepare-metadata-btn').forEach(btn => btn.addEventListener('click', handlePrepareMetadataClick));
    paneEl.querySelectorAll('.create-api-draft-btn').forEach(btn => btn.addEventListener('click', handleCreateApiDraftClick));
    paneEl.querySelectorAll('.upload-to-zenodo-btn').forEach(btn => btn.addEventListener('click', handleUploadFileClick));
    paneEl.querySelectorAll('.publish-on-zenodo-btn').forEach(btn => btn.addEventListener('click', handlePublishRecordClick));
    paneEl.querySelectorAll('.discard-draft-btn').forEach(btn => btn.addEventListener('click', handleDiscardDraftClick));
    paneEl.querySelectorAll('.edit-metadata-btn').forEach(btn => btn.addEventListener('click', handleEditMetadataClick));
    paneEl.querySelectorAll('.create-new-version-btn').forEach(btn => btn.addEventListener('click', handleCreateNewVersionClick));
    paneEl.querySelectorAll('.view-draft-files-btn').forEach(btn => btn.addEventListener('click', handleViewDraftFilesClick));
    paneEl.querySelectorAll('.item-select-checkbox').forEach(checkbox => checkbox.addEventListener('change', handleItemSelectionChange));
    paneEl.querySelectorAll('.view-file-bundle-btn').forEach(btn => btn.addEventListener('click', handleViewFileBundleClick));
}

// --- Single-Item Action Handlers ---
async function handlePrepareMetadataClick(event) {
    const sourceFileId = event.target.dataset.sourceFileId;
    openUploadProgressModal(`File ID ${sourceFileId}`);
    updateUploadProgressUI({ status: `Preparing metadata...`, progress: 10, logMsg: `Requesting metadata preparation...` });
    try {
        const isSandbox = uploadsEnvToggleEl.value === 'sandbox';
        if (!isSandbox && !confirm('⚠️ PRODUCTION ⚠️\n\nYou are about to prepare metadata for a new PRODUCTION record. Continue?')) {
            // Manually close the progress modal if the user cancels
            if (uploadProgressModalEl) uploadProgressModalEl.classList.add('hidden');
            return;
        }
        const response = await fetch(`${PYTHON_API_BASE_URL}/api/project/prepare_metadata_for_file`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                source_file_db_id: sourceFileId,
                hdpcPath: currentlyLoadedHdpcPath,
                target_is_sandbox: isSandbox
            })
        });
        const result = await response.json();
        logFullBackendResponse(result);
        if (!result.success) throw new Error(result.error || 'Preparation failed');
        updateUploadProgressUI({ status: result.message, progress: 100, type: 'success' });
        switchToUploadsTab('pending_operations');
        // clearZenodoSchemaCache();
    } catch (error) {
        updateUploadProgressUI({ status: `Error: ${error.message}`, progress: 100, type: 'error'});
    } finally {
        await refreshUploadsView();
    }
}

async function handleViewDraftFilesClick(event) {
    const recordId = event.target.dataset.recordId;
    if (recordId) {
        openDraftFilesModal(recordId);
    }
}

async function openDraftFilesModal(recordId) {
        const modal = document.getElementById('draftFilesModal');
        const titleEl = document.getElementById('draftFilesModalTitle');
        const bodyEl = document.getElementById('draftFilesModalBody');

        titleEl.textContent = `Files for Record ID: ${recordId}`;
        bodyEl.innerHTML = '<p class="text-center text-gray-500 p-4">Loading file details...</p>';
        modal.classList.remove('hidden');

        try {
            const response = await fetch(`${PYTHON_API_BASE_URL}/api/records/${recordId}/files`);
            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.error || `Failed to fetch files for record ${recordId}`);
            }
            const files = await response.json();

            if (files.length === 0) {
                bodyEl.innerHTML = '<p class="text-center text-gray-500 p-4">No files are associated with this record.</p>';
                return;
            }

            bodyEl.innerHTML = files.map(file => {
                const isSource = file.file_type === 'source';
                const originInfo = isSource
                    ? '<span class="text-xs text-gray-500">Original source file</span>'
                    : `<span class="text-xs text-green-700">Derived from Pipeline: <strong>${file.pipeline_source || 'N/A'}</strong> (Step: ${file.step_source || 'N/A'})</span>`;

                let statusHtml = '';
                const status = file.upload_status;

                if (status === 'uploaded') {
                    statusHtml = '<span class="text-xs font-medium text-green-700 bg-green-100 px-2 py-0.5 rounded-full">Uploaded</span>';
                } else if (status === 'pending') {
                    statusHtml = '<span class="text-xs font-medium text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">Pending</span>';
                } else if (status && status.includes('error')) {
                    statusHtml = `<span class="text-xs font-medium text-red-700 bg-red-100 px-2 py-0.5 rounded-full" title="${file.upload_error || 'An error occurred'}">Error</span>`;
                }


                return `
                    <div class="p-3 border rounded-md mb-2 flex items-center justify-between hover:bg-gray-50">
                        <div class="flex-grow min-w-0">
                            <div class="flex items-center gap-2 mb-1">
                                <p class="font-mono text-sm text-gray-800 truncate" title="${file.absolute_path}">${file.filename}</p>
                                ${statusHtml}
                            </div>
                            ${originInfo}
                        </div>
                        <div class="flex-shrink-0 ml-4">
                            <button data-path="${file.absolute_path}" class="open-file-btn btn-secondary text-xs py-1 px-2">Open</button>
                        </div>
                    </div>
                `;
            }).join('');

            // Add event listeners for the new "Open" buttons
            bodyEl.querySelectorAll('.open-file-btn').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    const filePath = e.target.dataset.path;
                    if (filePath && window.electronAPI?.openPath) {
                        const result = await window.electronAPI.openPath(filePath);
                        if (!result.success) {
                            showToast(`Error: ${result.error}`, 'error');
                        }
                    } else {
                        showToast('Cannot open file outside of the Electron app.', 'warning');
                    }
                });
            });

        } catch (error) {
            bodyEl.innerHTML = `<p class="text-center text-red-500 p-4">Error: ${error.message}</p>`;
        }
    }

/**
 * Recursively renders a file hierarchy node for the bundle modal.
 */
function createFileBundleNodeHTML(fileNode, level) {
    const indent = level * 20; // 20px indent per level
    const iconMap = {
        source: '<svg class="w-4 h-4 text-blue-600 mr-2 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"></path></svg>',
        primary: '<svg class="w-4 h-4 text-green-600 mr-2 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>',
        primary_source: '<svg class="w-4 h-4 text-yellow-500 mr-2 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"></path></svg>',
        secondary: '<svg class="w-4 h-4 text-gray-500 mr-2 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14z"></path></svg>',
        archive: '<svg class="w-4 h-4 text-indigo-600 mr-2 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4m-4-4h4m-4 8h4m-7 0h.01M9 3h6a2 2 0 012 2v3H7V5a2 2 0 012-2z"></path></svg>',
        archived_file: '<svg class="w-4 h-4 text-indigo-400 mr-2 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"></path></svg>'
    };
    const icon = iconMap[fileNode.file_type] || iconMap['source'];

    const statusClasses = {
        "Valid": "text-green-600 hover:text-green-800",
        "Invalid": "text-red-600 hover:text-red-800",
        "Problems": "text-red-600 hover:text-red-800 font-bold",
        "MTL Missing": "text-amber-600 hover:text-amber-800",
        "Textures Missing": "text-amber-600 hover:text-amber-800",
        "File Conflict": "text-purple-600 hover:text-purple-800 font-bold",
        "Pending": "text-blue-600 hover:text-blue-800"
    };
    const statusClass = statusClasses[fileNode.status] || "text-gray-600";
    
    const primarySourceTag = fileNode.file_type === 'primary_source' 
        ? `<span class="ml-2 text-xs font-semibold text-white bg-yellow-500 px-2 py-0.5 rounded-full">Primary Source</span>`
        : '';

    // Add archive info text if this is an archived file
    const archiveInfo = fileNode.file_type === 'archived_file' 
        ? `<span class="ml-2 text-xs italic text-indigo-700">(archived)</span>`
        : '';

    let rowHTML = `
        <div class="flex items-center py-1.5 text-sm">
            <div class="flex-grow flex items-center min-w-0" style="padding-left: ${indent}px;">
                ${icon}
                <span class="text-gray-800 truncate" title="${fileNode.absolute_path}">${fileNode.filename}</span>
                ${primarySourceTag}
                ${archiveInfo}
            </div>
            <div class="w-24 text-center flex-shrink-0">
                <button class="status-btn hover:underline text-xs font-medium ${statusClass}" data-file-id="${fileNode.file_id}">
                    ${fileNode.status}
                </button>
            </div>
        </div>
    `;

    if (fileNode.children && fileNode.children.length > 0) {
        rowHTML += fileNode.children.map(child => createFileBundleNodeHTML(child, level + 1)).join('');
    }
    return rowHTML;
}


async function handleViewFileBundleClick(event) {
    const sourceFileId = event.target.dataset.sourceFileId;
    const filename = event.target.dataset.filename;
    
    const modal = document.getElementById('fileBundleModal');
    const titleEl = document.getElementById('fileBundleModalTitle');
    const bodyEl = document.getElementById('fileBundleModalBody');
    
    if (!modal || !titleEl || !bodyEl) return;

    titleEl.textContent = `File Bundle: ${filename}`;
    bodyEl.innerHTML = '<p class="text-gray-500 text-center">Loading bundle contents...</p>';
    modal.classList.remove('hidden');
    
    fileBundleCache = {};

    // Recursive function to populate the cache
    function populateBundleCache(fileNode) {
        if (!fileNode) return;
        fileBundleCache[fileNode.file_id] = fileNode;
        if (fileNode.children) {
            fileNode.children.forEach(populateBundleCache);
        }
    }

    try {
        const response = await fetch(`${PYTHON_API_BASE_URL}/api/files/${sourceFileId}/hierarchy`);
        const hierarchyData = await response.json();
        
        if (!response.ok) {
            throw new Error(hierarchyData.error || 'Failed to fetch file hierarchy');
        }

        // Populate the cache *before* rendering
        populateBundleCache(hierarchyData);

        const headerHtml = `
            <div class="flex items-center p-2 border-b bg-gray-100 sticky top-0">
                <div class="flex-grow font-semibold text-xs text-gray-600 min-w-0">FILE</div>
                <div class="w-24 text-center font-semibold text-xs text-gray-600 flex-shrink-0">STATUS</div>
            </div>
        `;
        const bodyHtml = createFileBundleNodeHTML(hierarchyData, 0);
        bodyEl.innerHTML = `<div class="border rounded-md bg-gray-50 overflow-hidden">${headerHtml}<div class="p-2">${bodyHtml}</div></div>`;

    } catch (error) {
        bodyEl.innerHTML = `<p class="text-red-500 text-center">Error loading file data: ${error.message}</p>`;
    }
}

function openStatusModal(fileData) {
    const fileStatusModal = document.getElementById('fileStatusModal');
    const fileStatusModalTitle = document.getElementById('fileStatusModalTitle');
    const fileStatusModalBody = document.getElementById('fileStatusModalBody');

    if (!fileStatusModal || !fileStatusModalTitle || !fileStatusModalBody) return;

    fileStatusModalTitle.textContent = `Status Report: ${fileData.name || fileData.filename}`;
    
    let path = fileData.path || fileData.absolute_path;

    let bodyHTML = `
        <div>
            <h4 class="font-semibold text-gray-800">File Path</h4>
            <p class="font-mono text-xs bg-gray-100 p-2 rounded mt-1 break-all">${path}</p>
        </div>
    `;

    // Try to parse the report if it's a string (from our DB query)
    let report = fileData.validation_report;
    if (!report && fileData.error_message) {
         try {
            report = JSON.parse(fileData.error_message);
         } catch(e) {
            console.warn("Could not parse validation report from error_message field");
            report = { errors: [fileData.error_message] }; // Fallback
         }
    }


    if (report) {
        if (report.conflicts && report.conflicts.length > 0) {
            bodyHTML += `
                <div class="mt-4">
                    <h4 class="font-semibold text-purple-700">File Conflicts</h4>
                    <p class="text-sm text-gray-700 mt-1">The following texture files could not be automatically resolved because multiple, non-identical versions were found. Please resolve this manually by ensuring only one correct version exists in the search paths.</p>
                    ${report.conflicts.map(conflict => `
                        <div class="mt-2 pl-2 border-l-2 border-purple-200">
                            <p class="font-semibold text-sm text-purple-800">${conflict.filename}</p>
                            <p class="text-xs text-gray-600 italic">"${conflict.message}"</p>
                            <ul class="list-disc list-inside text-xs font-mono text-gray-600 mt-1">
                                ${conflict.candidates.map(path => `<li>${path}</li>`).join('')}
                            </ul>
                        </div>
                    `).join('')}
                </div>
            `;
        }
        // Display Validation Issues
        if (report.errors && report.errors.length > 0) {
            bodyHTML += `
                <div class="mt-4">
                    <h4 class="font-semibold text-red-700">Validation Issues</h4>
                    <ul class="list-disc list-inside text-sm text-red-600 mt-1 space-y-1">
                        ${report.errors.map(err => `<li>${err}</li>`).join('')}
                    </ul>
                </div>
            `;
        } else {
             bodyHTML += `
                <div class="mt-4">
                    <h4 class="font-semibold text-green-700">Validation Status</h4>
                    <p class="text-sm text-gray-700 mt-1">File appears to be valid and readable.</p>
                </div>
            `;
        }

        if (report.missing_textures && report.missing_textures.length > 0) {
            bodyHTML += `
                <div class="mt-4">
                    <h4 class="font-semibold text-amber-700 mt-3">Missing Texture Files</h4>
                    <div class="mt-1 p-2 border rounded-md bg-amber-50 text-xs font-mono text-amber-800 space-y-1">
                        ${report.missing_textures.map(filename => `<p>${filename}</p>`).join('')}
                    </div>
                </div>
            `;
        }

        // Display Validation Details
        if (report.details && Object.keys(report.details).length > 0) {
            bodyHTML += `
                <div class="mt-4">
                    <h4 class="font-semibold text-gray-800 mt-3">Validation Details</h4>
                    <div class="text-sm text-gray-700 mt-1 bg-gray-50 p-2 rounded border">
                        ${Object.entries(report.details).map(([key, value]) => `<p><strong>${key.replace(/_/g, ' ')}:</strong> ${value}</p>`).join('')}
                    </div>
                </div>
            `;
        }
    } else {
         bodyHTML += `
            <div class="mt-4">
                <h4 class="font-semibold text-gray-700">Validation Report</h4>
                <p class="text-sm text-gray-500 mt-1">No detailed validation report is available for this file.</p>
            </div>
        `;
    }

    fileStatusModalBody.innerHTML = bodyHTML;
    fileStatusModal.classList.remove('hidden');
}

async function handleCreateApiDraftClick(event) {
    const localRecordId = event.target.dataset.localRecordId;
    openUploadProgressModal(`Record ID ${localRecordId}`);
    updateUploadProgressUI({ status: `Creating Zenodo API draft...`, progress: 10, logMsg: `Requesting draft creation...` });
    try {
        const response = await fetch(`${PYTHON_API_BASE_URL}/api/project/create_api_draft_for_prepared_record`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ local_record_db_id: localRecordId })
        });
        const result = await response.json();
        logFullBackendResponse(result);
        if (!result.success) throw new Error(result.error || 'Draft creation failed');
        updateUploadProgressUI({ status: result.message, progress: 100, type: 'success' });
        switchToUploadsTab('drafts');
        // clearZenodoSchemaCache();
    } catch (error) {
        updateUploadProgressUI({ status: `Error: ${error.message}`, progress: 100, type: 'error'});
    } finally {
        await refreshUploadsView();
    }
}

async function handleUploadFileClick(event) {
    const recordId = event.target.dataset.recordId;
    openUploadProgressModal(`Files for Record ID ${recordId}`);
    updateUploadProgressUI({ status: `Starting file uploads...`, progress: 10, logMsg: `Requesting file uploads...` });
    try {
        // This endpoint in the backend should handle finding all pending files for the record.
        const response = await fetch(`${PYTHON_API_BASE_URL}/api/project/upload_files_for_deposition`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ local_record_db_id: recordId })
        });
        const result = await response.json();
        logFullBackendResponse(result);
        if (!result.success) throw new Error(result.error || 'Upload failed');
        updateUploadProgressUI({ status: result.message, progress: 100, type: 'success' });
    } catch (error) {
        updateUploadProgressUI({ status: `Error: ${error.message}`, progress: 100, type: 'error'});
    } finally {
        await refreshUploadsView();
    }
}

async function handlePublishRecordClick(event) {
    const localRecordDbId = event.target.dataset.recordId;
    const isSandbox = uploadsEnvToggleEl.value === 'sandbox';
    let confirmationMessage = 'Are you sure you want to publish this record? This action cannot be undone.';
    if (!isSandbox) {
        confirmationMessage = '⚠️ PRODUCTION ⚠️\n\nYou are about to publish this record to the LIVE Zenodo server. This is a permanent action.\n\nAre you absolutely sure you want to proceed?';
    }
    if (!confirm(confirmationMessage)) return;
    openUploadProgressModal(`Record ID ${localRecordDbId}`);
    updateUploadProgressUI({ status: `Publishing record...`, progress: 10, logMsg: `Requesting publish...` });
    try {
        const response = await fetch(`${PYTHON_API_BASE_URL}/api/project/publish_record`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ local_record_db_id: localRecordDbId })
        });
        const result = await response.json();
        logFullBackendResponse(result);
        if (!result.success) throw new Error(result.error || 'Publishing failed');
        updateUploadProgressUI({ status: result.message, progress: 100, type: 'success' });
    } catch (error) {
        updateUploadProgressUI({ status: `Error: ${error.message}`, progress: 100, type: 'error'});
    } finally {
        await refreshUploadsView();
    }
}

async function handleDiscardDraftClick(event) {
    const localRecordId = event.target.dataset.localRecordId;
    const isSandbox = uploadsEnvToggleEl.value === 'sandbox';
    if (!isSandbox && !confirm('⚠️ PRODUCTION ⚠️\n\nAre you sure you want to discard this LIVE Zenodo draft?')) {
        return;
    } else if (isSandbox && !confirm('Are you sure you want to discard this Zenodo draft?')) {
        return;
    }
    openUploadProgressModal(`Discarding Draft (DB ID: ${localRecordId})`);
    updateUploadProgressUI({ status: "Requesting draft discard...", progress: 10 });
    try {
        const response = await fetch(`${PYTHON_API_BASE_URL}/api/project/discard_zenodo_draft`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ local_record_db_id: localRecordId })
        });
        const result = await response.json();
        logFullBackendResponse(result);
        if (!result.success) throw new Error(result.error || 'Failed to discard draft.');
        updateUploadProgressUI({ status: result.message, progress: 100, type: 'success' });
        switchToUploadsTab('pending_operations');
    } catch (error) {
        updateUploadProgressUI({ status: `Error: ${error.message}`, progress: 100, type: 'error'});
    } finally {
        await refreshUploadsView();
    }
}

async function executePipelineForRecords(pipelineIdentifier, recordIds, conceptRecId = null, fileManifest = null) {
    const executionTitle = conceptRecId
        ? `Pipeline for New Version of ${conceptRecId}`
        : `Pipeline: ${pipelineIdentifier}`;
    
    openUploadProgressModal(executionTitle);

    const initialStatus = conceptRecId
        ? `Starting versioning pipeline for concept ${conceptRecId}...`
        : `Starting pipeline for ${recordIds.length} record(s)...`;
    updateUploadProgressUI({ status: initialStatus, progress: 5 });

    const pipeline = availablePipelines.find(p => p.identifier === pipelineIdentifier);
    const createsDraft = pipeline ? (pipeline.zenodoDraftStepEnabled !== false || conceptRecId) : false;

    try {
        const payload = {
    hdpcPath: currentlyLoadedHdpcPath
        };
        if (conceptRecId) {
            payload.concept_rec_id = conceptRecId;
            payload.file_manifest = fileManifest;
        } else {
            payload.record_ids = recordIds;
        }

        const response = await fetch(`${PYTHON_API_BASE_URL}/api/pipelines/${pipelineIdentifier}/execute`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const result = await response.json();
        logFullBackendResponse(result);

        if (!result.success) {
            throw new Error(result.error || 'Pipeline execution failed to start.');
        }

        updateUploadProgressUI({
            status: result.message,
            progress: 100,
            type: 'success',
            logMsg: result.message
        });

        showToast(result.message || "Pipeline execution finished.", "success");

        if (createsDraft) {
            switchToUploadsTab('drafts');
        }

    } catch (error) {
        updateUploadProgressUI({ status: `Error: ${error.message}`, progress: 100, type: 'error' });
        showToast(`Pipeline execution error: ${error.message}`, "error");
    } finally {
        await refreshUploadsView();
    }
}

async function handleEditMetadataClick(event) {
    const sourceFileId = event.target.dataset.sourceFileId;
    if (!sourceFileId) {
        showToast("Error: Missing source file ID.", "error");
        return;
    }
    
    saveAndPrepareMetadataBtn.dataset.sourceFileId = sourceFileId;

    editMetadataModal.classList.remove('hidden');
    editMetadataModalBody.innerHTML = '<p class="text-center text-gray-500">Loading metadata schema and preview...</p>';

    console.log(`%c[DEBUG] Step 1: Initiating metadata edit for source_file_id: ${sourceFileId}`, 'color: blue; font-weight: bold;');

    try {
        // 1. Ensure the Zenodo schema is loaded.
        await ensureZenodoSchema();

        console.log('[DEBUG] Step 2: Zenodo schema ensured. Current schema object:', JSON.parse(JSON.stringify(window.zenodoMappingSchema)));
        if (!window.zenodoMappingSchema || !window.zenodoMappingSchema.standard_fields) {
            console.error('%c[DEBUG] CRITICAL: The Zenodo schema object is missing or invalid at this point!', 'color: red; font-weight: bold;');
        }

        // 2. Fetch the metadata preview for the specific file.
        const response = await fetch(`${PYTHON_API_BASE_URL}/api/project/preview_mapped_values`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                source_file_db_id: sourceFileId,
                hdpcPath: currentlyLoadedHdpcPath 
            })
        });

        console.log('[DEBUG] Step 3: Received response from backend for preview.', response);

        const result = await response.json();

        console.log('%c[DEBUG] Step 4: Parsed JSON result from backend:', 'color: blue; font-weight: bold;', result);
        if (!result.success) {
            console.error('%c[DEBUG] Backend reported failure:', 'color: red; font-weight: bold;', result.error);
        }
        if (result.filename === undefined) {
            console.error('%c[DEBUG] CRITICAL: The "filename" property is missing from the backend response. This is the cause of the "Undefined" title.', 'color: red; font-weight: bold;');
        }

        if (!result.success) {
            throw new Error(result.error || "Failed to fetch metadata preview.");
        }

        editMetadataModalTitle.textContent = `Edit Metadata for: ${result.filename}`;
        
        const metadataForForm = result.prepared_metadata?.metadata;
        console.log('%c[DEBUG] Step 5: Data being passed to renderMetadataEditForm:', 'color: blue; font-weight: bold;', metadataForForm);
        if (!metadataForForm) {
            console.error('%c[DEBUG] CRITICAL: The "prepared_metadata.metadata" object is missing from the backend response. This is the cause of the empty fields.', 'color: red; font-weight: bold;');
        }

        // 3. Render the form using the fetched metadata.
        renderMetadataEditForm(metadataForForm);

    } catch (error) {
        console.error("Error in handleEditMetadataClick:", error);
        editMetadataModalBody.innerHTML = `<p class="text-red-500 p-4">Error: ${error.message}</p>`;
    }
}

// --- Modal Logic ---
function openUploadProgressModal(title) {
    if (uploadProgressTitleEl) uploadProgressTitleEl.textContent = `Progress: ${title}`;
    if (uploadProgressStatusEl) uploadProgressStatusEl.textContent = "Initializing...";
    if (uploadProgressBarEl) {
        uploadProgressBarEl.style.width = '0%';
        uploadProgressBarEl.className = 'bg-blue-600 h-6 rounded-full'; // Reset classes
    }
    if (uploadProgressPercentageEl) uploadProgressPercentageEl.textContent = '0%';
    if (uploadProgressLogEl) uploadProgressLogEl.textContent = '';
    if (uploadProgressModalEl) uploadProgressModalEl.classList.remove('hidden');
}

function updateUploadProgressUI({ status, progress, type = 'info', logMsg = null }) {
    if (uploadProgressStatusEl) uploadProgressStatusEl.textContent = status;
    if (uploadProgressBarEl) {
        uploadProgressBarEl.style.width = `${progress}%`;
        uploadProgressBarEl.classList.remove('bg-blue-600', 'bg-green-500', 'bg-red-500');
        if (type === 'success') uploadProgressBarEl.classList.add('bg-green-500');
        else if (type === 'error') uploadProgressBarEl.classList.add('bg-red-500');
        else uploadProgressBarEl.classList.add('bg-blue-600');
    }
    if (uploadProgressPercentageEl) uploadProgressPercentageEl.textContent = `${progress}%`;
    if (logMsg && uploadProgressLogEl) {
        uploadProgressLogEl.textContent += `[${new Date().toLocaleTimeString()}] ${logMsg}\n`;
        uploadProgressLogEl.scrollTop = uploadProgressLogEl.scrollHeight;
    }
}

function logFullBackendResponse(result) {
    if (!uploadProgressLogEl) return;
    if (result?.log) uploadProgressLogEl.textContent += result.log.map(l => `[LOG] ${l}\n`).join('');
    if (result?.validation_errors) uploadProgressLogEl.textContent += `[VALIDATION ERRORS]:\n${result.validation_errors.join('\n')}\n`;
    if (result?.zenodo_response) uploadProgressLogEl.textContent += `[ZENODO RESPONSE]:\n${JSON.stringify(result.zenodo_response, null, 2)}\n`;
    uploadProgressLogEl.scrollTop = uploadProgressLogEl.scrollHeight;
}

// --- Batch Action Logic ---
function handleItemSelectionChange(event) {
    const itemId = event.target.dataset.id;
    if (event.target.checked) selectedUploadItems.add(itemId);
    else selectedUploadItems.delete(itemId);
    updateBatchActionUI();
}

function updateBatchActionUI() {
    const numSelected = selectedUploadItems.size;
    const isPublishedTab = currentUploadsTab === 'published';

    // Decouple the visibility of the main batch actions and the new version section.
    uploadsBatchActionsContainerEl.classList.toggle('hidden', isPublishedTab || currentItemsInView.length === 0);
    const newVersionSection = document.getElementById('newVersionPipelineSection');
    if (newVersionSection) {
        // The new version section is ONLY visible on the published tab.
        newVersionSection.classList.toggle('hidden', !isPublishedTab);
    }

    // Update the standard batch action UI
    if (selectedItemsCountEl) selectedItemsCountEl.textContent = `${numSelected} selected.`;
    if (uploadsBatchActionDropdownEl) uploadsBatchActionDropdownEl.disabled = numSelected === 0;
    const canExecute = numSelected > 0 && uploadsBatchActionDropdownEl?.value !== "";
    if (executeBatchActionBtnEl) executeBatchActionBtnEl.disabled = !canExecute;

    // Update the "Select All" checkbox state
    if (selectAllItemsCheckboxEl) {
        const activePane = document.getElementById(`uploadsTabContent_${currentUploadsTab}`);
        if (activePane) {
            const allCheckboxes = activePane.querySelectorAll('.item-select-checkbox');
            if (allCheckboxes.length > 0 && numSelected === allCheckboxes.length) {
                selectAllItemsCheckboxEl.checked = true;
                selectAllItemsCheckboxEl.indeterminate = false;
            } else if (numSelected === 0 || allCheckboxes.length === 0) {
                selectAllItemsCheckboxEl.checked = false;
                selectAllItemsCheckboxEl.indeterminate = false;
            } else {
                selectAllItemsCheckboxEl.indeterminate = true;
            }
        }
    }
}

function populateBatchActionDropdown() {
    if (!uploadsBatchActionDropdownEl) return;
    uploadsBatchActionDropdownEl.innerHTML = '<option value="">-- Select Batch Action --</option>';

    // Only populate for tabs that have batch actions
    if (currentUploadsTab === 'pending_preparation') {
        uploadsBatchActionDropdownEl.innerHTML += '<option value="prepare_metadata">Prepare Metadata</option>';
        uploadsBatchActionDropdownEl.innerHTML += '<option value="remove_files">Remove Selected Files</option>';
    } else if (currentUploadsTab === 'pending_operations') {
        uploadsBatchActionDropdownEl.innerHTML += '<option value="create_api_draft">Create Zenodo Drafts</option>';
    } else if (currentUploadsTab === 'drafts') {
        uploadsBatchActionDropdownEl.innerHTML += '<option value="upload_main_files">Upload Files</option>';
        uploadsBatchActionDropdownEl.innerHTML += '<option value="discard_drafts">Discard Drafts</option>';
    }
    
    updateBatchActionUI();
}

// --- File/Directory Adding Logic ---
async function initiateAddFilesProcess() {
    if (typeof window.electronAPI === 'undefined' || typeof window.electronAPI.openFile !== 'function') {
        showToast("File operations are only available in the Electron application.", "error");
        return;
    }

    try {
        if (!isProjectLoaded()) {
            showToast("Please load a HDPC project first before adding files.", "error");
            return;
        }

        if (!mainAppConfigCache || Object.keys(mainAppConfigCache).length === 0) {
            showToast("Main app config not loaded. Cannot determine file filters.", "warning");
            // Attempt a fetch as a fallback
            const configResponse = await fetch(`${PYTHON_API_BASE_URL}/api/config/get`);
            if (!configResponse.ok) throw new Error('Failed to fetch main app config for file dialog.');
            const configData = await configResponse.json();
            mainAppConfigCache = configData.configData;
        }

        const projectModality = appDataCache.projectInfo[0]?.modality;
        let dialogFilters = [{ name: 'All Files', extensions: ['*'] }];

        if (projectModality && mainAppConfigCache.modality_file_filters?.[projectModality]) {
            const modalityFilterConfig = mainAppConfigCache.modality_file_filters[projectModality];
            const extensions = modalityFilterConfig.accepted_extensions;
            const filterName = modalityFilterConfig.default_filter_name || projectModality;

            if (Array.isArray(extensions) && extensions.length > 0) {
                const extensionsWithoutDots = extensions.map(ext => ext.startsWith('.') ? ext.substring(1) : ext);
                dialogFilters.unshift({ name: filterName, extensions: extensionsWithoutDots });
            }
        }

        const filePathsArray = await window.electronAPI.openFile({
            properties: ['openFile', 'multiSelections', 'showHiddenFiles', 'dontAddToRecent'],
            title: "Select Source File(s) to Add to Project",
            filters: dialogFilters
        });

        if (Array.isArray(filePathsArray) && filePathsArray.length > 0) {
            await backendAddSourceFiles(filePathsArray);
        } else if (filePathsArray) { // Not an array, but a single file path string
            await backendAddSourceFiles([filePathsArray]);
        }
    } catch (err) {
        console.error("Error in 'Add File(s)' operation:", err);
        showToast(`Error during file selection: ${err.message}`, "error");
    }
}

async function initiateAddDirectoryProcess() {
    if (typeof window.electronAPI === 'undefined' || typeof window.electronAPI.openDirectory !== 'function' || typeof window.electronAPI.listDirectoryFiles !== 'function') {
        showToast("Directory operations are only available in the Electron application.", "error");
        return;
    }
    
    if (!isProjectLoaded()) {
        showToast("Please load a HDPC project first before adding a directory.", "error");
        return;
    }

    try {
        const directoryPath = await window.electronAPI.openDirectory();
        if (directoryPath) {
            const includeSubdirs = confirm("Include files in subdirectories as well?");
            const filesFromDir = await window.electronAPI.listDirectoryFiles(directoryPath, includeSubdirs);
            
            if (filesFromDir && filesFromDir.length > 0) {
                await backendAddSourceFiles(filesFromDir);
            } else if (filesFromDir) { // An empty array was returned
                showToast("No files found in the selected directory.", "info");
            }
        }
    } catch (err) {
        console.error("Error with directory selection/listing for add files:", err);
        showToast(`Error during directory operation: ${err.message}`, "error");
    }
}

// --- Pipeline Integration ---
async function loadPipelinesForUploads() {
    try {
        const response = await fetch(`${PYTHON_API_BASE_URL}/api/pipelines`);
        if (!response.ok) throw new Error('Failed to load pipelines');
        
        availablePipelines = await response.json();
        updateAllPipelineDropdowns(); // Use the new generic function
    } catch (error) {
        console.error('Error loading pipelines for uploads:', error);
        showToast('Failed to load pipelines', 'error');
    }
}

function updateAllPipelineDropdowns() {
    const dropdowns = [
        document.getElementById('pipelineDropdown'),
        document.getElementById('newVersionPipelineSelect'),
        document.getElementById('newVersionModalPipelineSelect')
    ];
    
    dropdowns.forEach(dropdown => {
        if (!dropdown) return;
        
        const currentValue = dropdown.value;
        dropdown.innerHTML = '<option value="">-- Select a pipeline --</option>';
        
        availablePipelines.forEach(pipeline => {
            const option = document.createElement('option');
            option.value = pipeline.identifier;
            option.textContent = `${pipeline.name} (${pipeline.modality})`;
            dropdown.appendChild(option);
        });

        // Restore previous selection if it's still a valid option
        if (availablePipelines.some(p => p.identifier === currentValue)) {
            dropdown.value = currentValue;
        }
    });
}

function showPipelineSelectionSection(show) {
    const section = document.getElementById('pipelineSelectionSection');
    if (section) {
        section.classList.toggle('hidden', !show);
    }
}

function openPipelineExecutionModal(pipelineIdentifier) {
    const modal = document.getElementById('pipelineExecutionModal');
    const pipelineInfo = document.getElementById('selectedPipelineInfo');
    
    // Find selected pipeline details
    const pipeline = availablePipelines.find(p => p.identifier === pipelineIdentifier);
    if (pipeline && pipelineInfo) {
        pipelineInfo.textContent = `${pipeline.name} (${pipeline.modality}) - ${pipeline.description || 'No description'}`;
    }
    
    // Reset form
    document.getElementById('titlePatternInput').value = '';
    document.getElementById('dateFromFilter').value = '';
    document.getElementById('dateToFilter').value = '';
    document.getElementById('recordSearchInput').value = '';
    
    // Load current records for filtering
    loadCurrentRecordsForFiltering();
    
    modal.classList.remove('hidden');
}

async function loadCurrentRecordsForFiltering() {
    try {
        // Get current pending_operations records
        const isSandboxForView = uploadsEnvToggleEl.value === 'sandbox';
        const response = await fetch(`${PYTHON_API_BASE_URL}/api/project/uploads_by_tab?hdpcPath=${encodeURIComponent(currentlyLoadedHdpcPath)}&tab_id=pending_operations&is_sandbox=${isSandboxForView}`);
        
        if (!response.ok) throw new Error('Failed to load records');
        
        currentPendingOperationsRecords = await response.json();
        filterAndDisplayRecords();
    } catch (error) {
        console.error('Error loading records for filtering:', error);
        showToast('Failed to load records for filtering', 'error');
    }
}

function filterAndDisplayRecords() {
    const titlePattern = document.getElementById('titlePatternInput').value.trim();
    const dateFromFilter = document.getElementById('dateFromFilter').value;
    const dateToFilter = document.getElementById('dateToFilter').value;
    const searchTerm = document.getElementById('recordSearchInput').value.toLowerCase().trim();
    
    let filteredRecords = [...currentPendingOperationsRecords];
    
    // Apply title pattern filter
    if (titlePattern) {
        const regex = new RegExp('^' + titlePattern.replace(/\*/g, '.*') + '$', 'i');
        filteredRecords = filteredRecords.filter(record => 
            regex.test(record.record_title || record.filename || '')
        );
    }
    
    // Apply date range filter using record_created_date (created_timestamp)
    if (dateFromFilter || dateToFilter) {
        filteredRecords = filteredRecords.filter(record => {
            if (!record.record_created_date) return true; // Include records without date
            
            const recordDate = new Date(record.record_created_date);
            recordDate.setHours(0, 0, 0, 0); // Set to start of day for comparison
            
            let passesFromDate = true;
            let passesToDate = true;
            
            if (dateFromFilter) {
                const fromDate = new Date(dateFromFilter);
                fromDate.setHours(0, 0, 0, 0);
                passesFromDate = recordDate >= fromDate;
            }
            
            if (dateToFilter) {
                const toDate = new Date(dateToFilter);
                toDate.setHours(23, 59, 59, 999); // Set to end of day for comparison
                passesToDate = recordDate <= toDate;
            }
            
            return passesFromDate && passesToDate;
        });
    }
    
    // Apply search term filter
    if (searchTerm) {
        filteredRecords = filteredRecords.filter(record => 
            (record.record_title || '').toLowerCase().includes(searchTerm) ||
            (record.filename || '').toLowerCase().includes(searchTerm)
        );
    }
    
    displayFilteredRecords(filteredRecords);
}

function displayFilteredRecords(records) {
    const container = document.getElementById('affectedRecordsList');
    const countInfo = document.getElementById('recordCountInfo');
    const confirmBtn = document.getElementById('confirmPipelineExecution');
    
    if (countInfo) {
        countInfo.textContent = `${records.length} record${records.length !== 1 ? 's' : ''}`;
    }
    
    if (confirmBtn) {
        confirmBtn.disabled = records.length === 0;
    }
    
    if (records.length === 0) {
        container.innerHTML = '<div class="p-4 text-center text-gray-500"><p>No records match the current filters</p></div>';
        return;
    }
    
    container.innerHTML = records.map(record => `
        <div class="p-3 border-b border-gray-200 hover:bg-gray-50">
            <div class="flex items-center">
                <input type="checkbox" class="record-checkbox mr-3 h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500" 
                    data-record-id="${record.local_record_db_id}" checked>
                <div class="flex-grow">
                    <p class="font-medium text-sm text-gray-900">${record.record_title || record.filename}</p>
                    <p class="text-xs text-gray-500">
                        DB ID: ${record.local_record_db_id} | Status: ${record.zenodo_record_db_status}
                        ${record.record_created_date ? ` | Created: ${new Date(record.record_created_date).toLocaleDateString()}` : ''}
                    </p>
                </div>
            </div>
        </div>
    `).join('');
}

function setupPipelineSelectionListeners() {
    const dropdown = document.getElementById('pipelineDropdown');
    const viewBtn = document.getElementById('viewInConstructorBtn');
    const executeBtn = document.getElementById('initiatePipelineExecutionBtn');
    
    if (dropdown) {
        dropdown.addEventListener('change', function() {
            const selected = this.value;
            const hasSelection = selected !== '';
            
            if (viewBtn) viewBtn.disabled = !hasSelection;
            if (executeBtn) executeBtn.disabled = !hasSelection;
            updatePipelineOverwriteInfo(selected);
        });
    }
    
    if (viewBtn) {
        viewBtn.addEventListener('click', function() {
            const selectedPipeline = dropdown.value;
            if (selectedPipeline) {
                // Switch to pipeline constructor view and load the pipeline
                navigateToView('pipeline-constructor');
                if (window.pipelineConstructor) {
                    window.pipelineConstructor.loadPipeline(selectedPipeline);
                }
            }
        });
    }
    
    if (executeBtn) {
        executeBtn.addEventListener('click', function() {
            const selectedPipeline = dropdown.value;
            if (selectedPipeline) {
                openPipelineExecutionModal(selectedPipeline);
            }
        });
    }
}

function setupPipelineExecutionModalListeners() {
    const modal = document.getElementById('pipelineExecutionModal');
    const closeBtn = document.getElementById('closePipelineExecution');
    const cancelBtn = document.getElementById('cancelPipelineExecution');
    const confirmBtn = document.getElementById('confirmPipelineExecution');
    const titlePatternInput = document.getElementById('titlePatternInput');
    const dateFromFilter = document.getElementById('dateFromFilter');
    const dateToFilter = document.getElementById('dateToFilter');
    const searchInput = document.getElementById('recordSearchInput');
    const pipelineDropdown = document.getElementById('pipelineDropdown');


    // Close modal handlers
    [closeBtn, cancelBtn].forEach(btn => {
        if (btn) {
            btn.addEventListener('click', () => modal.classList.add('hidden'));
        }
    });

    // Filter handlers
    [titlePatternInput, dateFromFilter, dateToFilter, searchInput].forEach(input => {
        if (input) {
            input.addEventListener('input', filterAndDisplayRecords);
        }
    });


    // Confirm execution handler
    if (confirmBtn) {
        confirmBtn.addEventListener('click', function() {
            const selectedPipeline = pipelineDropdown.value;
            const checkedRecords = Array.from(document.querySelectorAll('.record-checkbox:checked'))
                .map(cb => parseInt(cb.dataset.recordId, 10));

            if (!selectedPipeline) {
                showToast('You must select a pipeline to execute.', 'warning');
                return;
            }

            if (checkedRecords.length === 0) {
                showToast('Please select at least one record to process.', 'warning');
                return;
            }

            modal.classList.add('hidden');
            executePipelineForRecords(selectedPipeline, checkedRecords);
        });
    }
}

// --- Initialization ---
export function initUploads() {
    // Main view listeners
    // --- Information about Pipeline Output Mappings to Zenodo Metadata
    if (pipelineSelectionSection) {
        const overwriteInfoEl = document.createElement('div');
        overwriteInfoEl.id = 'pipelineOverwriteInfo';
        overwriteInfoEl.className = 'text-xs text-gray-600 p-3 bg-gray-50 rounded-md mt-2 border border-gray-200 hidden'; // Start hidden
        // Insert it right after the buttons container for better placement
        const buttonContainer = pipelineSelectionSection.querySelector('.flex.items-center.gap-2');
        if (buttonContainer) {
            buttonContainer.insertAdjacentElement('afterend', overwriteInfoEl);
        } else {
            pipelineSelectionSection.appendChild(overwriteInfoEl);
        }
    }
    if (uploadsEnvToggleEl) {
        uploadsEnvToggleEl.addEventListener('change', () => {
            productionWarningEl.classList.toggle('hidden', uploadsEnvToggleEl.value !== 'production');
            refreshUploadsView();
        });
    }
    if (refreshUploadsViewBtn) refreshUploadsViewBtn.addEventListener('click', refreshUploadsView);
    uploadsTabBtns.forEach(button => {
        button.addEventListener('click', () => {
            currentUploadsTab = button.dataset.tabId;
            uploadsTabBtns.forEach(btn => {
                btn.classList.toggle('text-blue-600', btn === button);
                btn.classList.toggle('border-blue-600', btn === button);
                btn.classList.toggle('text-gray-500', btn !== button);
                btn.classList.toggle('border-transparent', btn !== button);
            });
            uploadsTabPanes.forEach(pane => pane.classList.toggle('hidden', pane.id !== `uploadsTabContent_${currentUploadsTab}`));
            loadUploadsTabContent();
        });
    });

    // Batch action listeners
    if (selectAllItemsCheckboxEl) selectAllItemsCheckboxEl.addEventListener('change', (event) => {
        const isChecked = event.target.checked;
        const activePane = document.getElementById(`uploadsTabContent_${currentUploadsTab}`);
        activePane.querySelectorAll('.item-select-checkbox').forEach(checkbox => {
            checkbox.checked = isChecked;
            handleItemSelectionChange({ target: checkbox });
        });
    });
    if (executeBatchActionBtnEl) executeBatchActionBtnEl.addEventListener('click', async () => {
        const actionType = uploadsBatchActionDropdownEl.value;
        const itemIds = Array.from(selectedUploadItems);

        if (!actionType || itemIds.length === 0) {
            showToast("No action or items selected for batch operation.", "warning");
            return;
        }

        const targetIsSandbox = uploadsEnvToggleEl.value === 'sandbox';
        const actionDescription = uploadsBatchActionDropdownEl.options[uploadsBatchActionDropdownEl.selectedIndex].text;

        if (!confirm(`Are you sure you want to execute "${actionDescription}" on ${itemIds.length} item(s)?`)) {
            showToast("Batch action cancelled.", "info");
            return;
        }

        openUploadProgressModal(`Batch: ${actionDescription}`);
        updateUploadProgressUI({ status: `Starting batch operation on ${itemIds.length} items...`, progress: 5, logMsg: `Action: ${actionType}` });
        
        executeBatchActionBtnEl.disabled = true;

        try {
            const response = await fetch(`${PYTHON_API_BASE_URL}/api/project/batch_action`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    action_type: actionType, 
                    item_ids: itemIds,
                    target_is_sandbox: targetIsSandbox
                })
            });
            const batchResult = await response.json();
            logFullBackendResponse(batchResult);

            let finalMessage = `Batch operation completed.`;
            if (batchResult.results) {
                const successCount = batchResult.results.filter(r => r.success).length;
                finalMessage += ` ${successCount} of ${batchResult.results.length} succeeded.`;
            }
             updateUploadProgressUI({ status: finalMessage, progress: 100, type: batchResult.success ? 'success' : 'warning' });
            
            if (batchResult.results && uploadProgressLogEl) {
                uploadProgressLogEl.textContent += "\n--- Individual Item Results ---\n";
                batchResult.results.forEach(res => {
                    uploadProgressLogEl.textContent += `ID ${res.id}: ${res.success ? 'OK' : 'FAIL'} - ${res.message || res.error || ''}\n`;
                });
                uploadProgressLogEl.scrollTop = uploadProgressLogEl.scrollHeight;
            }
            showToast(finalMessage, batchResult.success ? "success" : "warning", 5000);

        } catch (error) {
            updateUploadProgressUI({ status: `Batch Error: ${error.message}`, progress: 100, type: 'error' });
            showToast(`Batch Action Failed: ${error.message}`, "error");
        } finally {
            if (actionType === 'prepare_metadata') {
                switchToUploadsTab('pending_operations');
            } else if (actionType === 'create_api_draft') {
                switchToUploadsTab('drafts');
            }
            selectedUploadItems.clear();
            await refreshUploadsView();
            updateBatchActionUI();
        }
    });

    // Add files/directory listeners
    if (uploadsViewAddFilesBtn) uploadsViewAddFilesBtn.addEventListener('click', initiateAddFilesProcess);
    if (uploadsViewAddDirectoryBtn) uploadsViewAddDirectoryBtn.addEventListener('click', initiateAddDirectoryProcess);

    // Modal listeners
    if (closeUploadProgressModalBtnEl) closeUploadProgressModalBtnEl.addEventListener('click', () => uploadProgressModalEl.classList.add('hidden'));
    if (closeEditMetadataModalBtn) closeEditMetadataModalBtn.addEventListener('click', () => editMetadataModal.classList.add('hidden'));
    if (cancelEditMetadataBtn) cancelEditMetadataBtn.addEventListener('click', () => editMetadataModal.classList.add('hidden'));
    if (saveAndPrepareMetadataBtn) saveAndPrepareMetadataBtn.addEventListener('click', async (event) => {
        const sourceFileId = event.target.dataset.sourceFileId;
        const overrides = {};

        // Gather Standard Fields
        editMetadataModalBody.querySelectorAll('.settings-section:first-child .py-3').forEach(fieldDiv => {
            const key = fieldDiv.dataset.fieldKey;
            const input = fieldDiv.querySelector('.edit-input');
            if (key && input) {
                // Handle keywords separately as they need to be an array
                if (key === 'keywords') {
                    overrides[key] = input.value.split(',').map(k => k.trim()).filter(Boolean);
                } else {
                    overrides[key] = input.value;
                }
            }
        });

        // Gather Complex Fields
        editMetadataModalBody.querySelectorAll('.complex-field-item').forEach(complexDiv => {
            const fieldKey = complexDiv.dataset.fieldKey;
            const entries = [];
            complexDiv.querySelectorAll('.complex-entry').forEach(entryDiv => {
                const currentEntry = {};
                entryDiv.querySelectorAll('.edit-input').forEach(input => {
                    const attrKey = input.dataset.attributeKey;
                    if (attrKey && input.value) {
                        // Structure matches what the backend expects for complex field values
                        currentEntry[attrKey] = { type: 'literal', value: input.value };
                    }
                });
                if (Object.keys(currentEntry).length > 0) {
                    entries.push(currentEntry);
                }
            });
            if (entries.length > 0) {
                overrides[fieldKey] = { type: 'complex', is_complex: true, entries: entries };
            }
        });

        editMetadataModal.classList.add('hidden');
        openUploadProgressModal(`Preparing metadata for File ID ${sourceFileId}...`);
        
        try {
            const response = await fetch(`${PYTHON_API_BASE_URL}/api/project/prepare_metadata_for_file`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    source_file_db_id: parseInt(sourceFileId, 10),
                    overrides: overrides
                })
            });
            const result = await response.json();
            logFullBackendResponse(result);

            if (result.success) {
                updateUploadProgressUI({ status: result.message, progress: 100, type: 'success' });
                switchToUploadsTab('pending_operations');
                // clearZenodoSchemaCache();
            } else {
                const errorMsg = result.validation_errors ? `Validation Failed: ${result.validation_errors.join(', ')}` : result.error;
                throw new Error(errorMsg);
            }
        } catch (error) {
            updateUploadProgressUI({ status: `Error preparing metadata: ${error.message}`, progress: 100, type: 'error'});
        } finally {
            await refreshUploadsView();
        }
    });

    const draftFilesModal = document.getElementById('draftFilesModal');
    const closeDraftFilesModalBtn = document.getElementById('closeDraftFilesModalBtn');
    const closeDraftFilesModalFooterBtn = document.getElementById('closeDraftFilesModalFooterBtn');

    if (closeDraftFilesModalBtn) closeDraftFilesModalBtn.addEventListener('click', () => draftFilesModal.classList.add('hidden'));
    if (closeDraftFilesModalFooterBtn) closeDraftFilesModalFooterBtn.addEventListener('click', () => draftFilesModal.classList.add('hidden'));

    // File Bundle Modal Listeners
    const fileBundleModal = document.getElementById('fileBundleModal');
    const closeFileBundleModalBtn = document.getElementById('closeFileBundleModalBtn');
    const closeFileBundleModalFooterBtn = document.getElementById('closeFileBundleModalFooterBtn');

    if (fileBundleModal && closeFileBundleModalBtn) {
        closeFileBundleModalBtn.addEventListener('click', () => fileBundleModal.classList.add('hidden'));
    }
    if (fileBundleModal && closeFileBundleModalFooterBtn) {
        closeFileBundleModalFooterBtn.addEventListener('click', () => fileBundleModal.classList.add('hidden'));
    }

    const fileBundleModalBody = document.getElementById('fileBundleModalBody');
    if (fileBundleModalBody) {
        fileBundleModalBody.addEventListener('click', (event) => {
            const statusBtn = event.target.closest('.status-btn');
            if (statusBtn) {
                const fileId = statusBtn.dataset.fileId;
                const fileData = fileBundleCache[fileId];
                if (fileData) {
                    openStatusModal(fileData);
                } else {
                    console.error("Could not find file data in bundle cache for ID:", fileId);
                    showToast("Could not retrieve file details.", "error");
                }
            }
        });
    }
    
    // Versioning Listeners
    const initiateNewVersionBtn = document.getElementById('initiateNewVersionBtn');
    if (initiateNewVersionBtn) {
        initiateNewVersionBtn.addEventListener('click', openNewVersionFromFileModal);
    }
    
    // Add new modal listeners
    if (closeNewVersionFromFileModal) {
        closeNewVersionFromFileModal.addEventListener('click', () => {
            newVersionFromFileModal.classList.add('hidden');
        });
    }

    if (browseNewVersionDirectoryBtn) {
        browseNewVersionDirectoryBtn.addEventListener('click', async () => {
             const path = await window.electronAPI.openDirectory();
             if (path) newVersionDirectoryPath.value = path;
        });
    }
    
    if(processingModeRoot) {
        processingModeRoot.addEventListener('change', () => {
            rootOptionsContainer.classList.remove('hidden');
            subdirectoryMessage.classList.add('hidden');
        });
    }
    
    if(processingModeSubdirectory) {
         processingModeSubdirectory.addEventListener('change', () => {
            rootOptionsContainer.classList.add('hidden');
            subdirectoryMessage.classList.remove('hidden');
        });
    }

    if (scanFilesForMatchesBtn) {
        scanFilesForMatchesBtn.addEventListener('click', handleScanForMatches);
    }
    
    if (backToStep1Btn) {
        backToStep1Btn.addEventListener('click', () => {
            newVersionFromFileStep1.classList.remove('hidden');
            newVersionFromFileStep2.classList.add('hidden');
            scanFilesForMatchesBtn.classList.remove('hidden');
            proceedToVersioningBtn.classList.add('hidden');
            backToStep1Btn.classList.add('hidden');
        });
    }
    
    if (proceedToVersioningBtn) {
        proceedToVersioningBtn.addEventListener('click', async () => {
            const selectedForVersioning = [];
            document.querySelectorAll('.matched-record-checkbox:checked').forEach(cb => {
                selectedForVersioning.push({
                    conceptRecId: cb.dataset.conceptId,
                    fileManifest: {
                        files_to_keep: [], 
                        new_source_file_path: cb.dataset.newSourcePath
                    }
                });
            });

            if (selectedForVersioning.length === 0) {
                showToast("Please select at least one matched record to proceed.", "warning");
                return;
            }

            const mainPipelineSelectEl = document.getElementById('newVersionPipelineSelect');
            const pipelineIdentifier = mainPipelineSelectEl ? mainPipelineSelectEl.value : '';

            if (!pipelineIdentifier) {
                showToast("Please select a pipeline from the dropdown before proceeding.", "warning");
                return;
            }
            
            const selectedPipeline = availablePipelines.find(p => p.identifier === pipelineIdentifier);
            const userConfirmed = confirm(
                `You are about to execute the pipeline:\n\n"${selectedPipeline.name}"\n\nfor ${selectedForVersioning.length} selected record(s). This will create new drafts on Zenodo.\n\nDo you want to proceed?`
            );

            if (!userConfirmed) {
                showToast("Operation cancelled.", "info");
                return;
            }

            newVersionFromFileModal.classList.add('hidden');

            for (const item of selectedForVersioning) {
                await executePipelineForRecords(pipelineIdentifier, [], item.conceptRecId, item.fileManifest);
            }
        });
    }

    
    // Pipeline selection listeners
    setupPipelineSelectionListeners();
    setupPipelineExecutionModalListeners();
}

function renderMetadataEditForm(metadata) {
    editMetadataModalBody.innerHTML = ''; // Clear previous content
    const schema = window.zenodoMappingSchema;
    if (!schema) {
        editMetadataModalBody.innerHTML = `<p class="text-red-500 p-4">Error: Zenodo mapping schema not available.</p>`;
        return;
    }

    // Render Standard Fields
    const standardFieldsSection = document.createElement('div');
    standardFieldsSection.className = 'settings-section mb-6';
    standardFieldsSection.innerHTML = `<h4 class="text-lg font-semibold text-gray-800 mb-3 pb-2 border-b">Standard Fields</h4>`;
    schema.standard_fields.forEach(fieldSchema => {
        standardFieldsSection.appendChild(renderSingleFieldEditor(fieldSchema, metadata[fieldSchema.key]));
    });
    editMetadataModalBody.appendChild(standardFieldsSection);

    // Render Complex Fields
    const complexFieldsSection = document.createElement('div');
    complexFieldsSection.className = 'settings-section mb-6';
    complexFieldsSection.innerHTML = `<h4 class="text-lg font-semibold text-gray-800 mt-6 mb-3 pt-4 border-t">Complex & Repeated Fields</h4>`;
    
    Object.entries(schema.complex_fields || {}).forEach(([fieldKey, fieldConfig]) => {
        const complexFieldData = metadata[fieldKey];

        // robust check to ensure 'entries' is an array
        const existingEntries = (complexFieldData && Array.isArray(complexFieldData.entries))
            ? complexFieldData.entries
            : [];

        complexFieldsSection.appendChild(renderComplexFieldEditor(fieldKey, fieldConfig, existingEntries));
    });
    editMetadataModalBody.appendChild(complexFieldsSection);
}

function renderSingleFieldEditor(fieldSchema, currentValue) {
    const fieldWrapper = document.createElement('div');
    fieldWrapper.className = 'py-3 border-b border-gray-200';
    fieldWrapper.dataset.fieldKey = fieldSchema.key;

    // For keywords, which are stored as an array.
    const displayValue = Array.isArray(currentValue) ? currentValue.join(', ') : currentValue;

    fieldWrapper.innerHTML = `
        <div class="md:flex md:items-start md:space-x-4">
            <div class="md:w-1/3">
                <label class="block text-sm font-medium text-gray-700">${fieldSchema.label}</label>
                ${fieldSchema.notes ? `<p class="text-xs text-gray-500">${fieldSchema.notes}</p>` : ''}
            </div>
            <div class="mt-1 md:mt-0 md:w-2/3">
                <input type="text" class="edit-input w-full p-2 border-gray-300 rounded-md text-sm" value="${displayValue || ''}">
            </div>
        </div>
    `;
    return fieldWrapper;
}

function renderComplexFieldEditor(fieldKey, fieldConfig, existingEntries) {
    const complexFieldWrapper = document.createElement('div');
    complexFieldWrapper.className = 'py-3 border-t border-gray-200';
    complexFieldWrapper.dataset.fieldKey = fieldKey;

    let entriesHtml = existingEntries.map((entry, index) => {
        const attributesHtml = fieldConfig.attributes.map(attr => `
            <div class="mb-2">
                <label class="block text-xs font-medium text-gray-600">${attr.label}</label>
                <input type="text" class="edit-input w-full p-1.5 text-xs border border-gray-300 rounded-md" 
                       data-attribute-key="${attr.key}" value="${entry[attr.key]?.value || ''}">
            </div>
        `).join('');

        return `
            <div class="p-3 border rounded-md bg-gray-50 complex-entry relative mb-3" data-entry-index="${index}">
                ${attributesHtml}
            </div>
        `;
    }).join('');

    complexFieldWrapper.innerHTML = `
        <div>
            <label class="block text-sm font-medium text-gray-700">${fieldConfig.label}</label>
            ${fieldConfig.notes ? `<p class="text-xs text-gray-500">${fieldConfig.notes}</p>` : ''}
        </div>
        <div class="complex-entries-container mt-2 space-y-3">
            ${entriesHtml || '<p class="text-xs text-gray-500 italic">No entries for this field.</p>'}
        </div>
    `;
    return complexFieldWrapper;
}

function switchToUploadsTab(tabId) {
    const targetTabBtn = document.querySelector(`.uploads-tab-btn[data-tab-id="${tabId}"]`);
    if (targetTabBtn) {
        // Deactivate all tabs
        uploadsTabBtns.forEach(btn => {
            btn.classList.remove('text-blue-600', 'border-blue-600');
            btn.classList.add('text-gray-500', 'border-transparent');
        });
        // Hide all panes
        uploadsTabPanes.forEach(pane => pane.classList.add('hidden'));

        // Activate the target tab and pane
        targetTabBtn.classList.add('text-blue-600', 'border-blue-600');
        targetTabBtn.classList.remove('text-gray-500', 'border-transparent');
        const targetPane = document.getElementById(`uploadsTabContent_${tabId}`);
        if (targetPane) {
            targetPane.classList.remove('hidden');
        }
        currentUploadsTab = tabId;
    }
}

/**
 * Updates the UI to show which Zenodo fields might be overwritten by the selected pipeline.
 * @param {string} pipelineIdentifier The identifier of the selected pipeline.
 */
function updatePipelineOverwriteInfo(pipelineIdentifier) {
    const infoEl = document.getElementById('pipelineOverwriteInfo');
    if (!infoEl) return;

    if (!pipelineIdentifier) {
        infoEl.classList.add('hidden');
        infoEl.innerHTML = '';
        return;
    }

    const pipeline = availablePipelines.find(p => p.identifier === pipelineIdentifier);
    if (!pipeline) {
        infoEl.classList.add('hidden');
        return;
    }

    const overwrittenFields = new Set();

    // Iterate through the pipeline to find all defined output mappings
    (pipeline.steps || []).forEach(step => {
        (step.outputs || []).forEach(output => {
            if (output.outputMapping?.mapToZenodo) {
                (output.outputMapping.zenodoMappings || []).forEach(mapping => {
                    if (mapping.zenodoField) {
                        overwrittenFields.add(mapping.zenodoField);
                    }
                });
            }
        });
    });

    if (overwrittenFields.size > 0) {
        const fieldsList = Array.from(overwrittenFields).map(field => `<code class="bg-yellow-200 text-yellow-800 px-1 rounded">${field}</code>`).join(', ');
        infoEl.innerHTML = `💡 This pipeline may overwrite the following metadata fields from its outputs: ${fieldsList}.`;
        infoEl.classList.remove('hidden');
    } else {
        infoEl.innerHTML = 'ℹ️ This pipeline is not configured to overwrite any metadata from its outputs.';
        infoEl.classList.remove('hidden');
    }
}

async function openNewVersionModal() {
    const modal = document.getElementById('newVersionModal');
    const titleEl = document.getElementById('newVersionModalTitle');
    // Get a reference to the dropdown in the main view
    const mainPipelineSelectEl = document.getElementById('newVersionPipelineSelect');
    // Get a reference to the dropdown in the modal
    const modalPipelineSelectEl = document.getElementById('newVersionModalPipelineSelect');
    const confirmBtn = document.getElementById('confirmNewVersionBtn');
    const cancelBtn = document.getElementById('cancelNewVersionBtn');
    const closeBtn = document.getElementById('closeNewVersionModal');

    const selectedConceptIds = Array.from(selectedUploadItems);
    if (selectedConceptIds.length === 0) {
        showToast("Please select at least one published record set to create a new version.", "warning");
        return;
    }

    titleEl.textContent = `Create New Version for ${selectedConceptIds.length} Record Set(s)`;

    // Populate the pipeline dropdown inside the modal
    modalPipelineSelectEl.innerHTML = '<option value="">-- Select a Pipeline --</option>';
    availablePipelines.forEach(p => {
        modalPipelineSelectEl.innerHTML += `<option value="${p.identifier}">${p.name}</option>`;
    });

    // Synchronize the dropdown values
    if (mainPipelineSelectEl) {
        modalPipelineSelectEl.value = mainPipelineSelectEl.value;
    }

    // Reset file manifest UI
    document.getElementById('fileKeepAll').checked = true;
    document.getElementById('fileKeepPatterns').checked = false;
    document.getElementById('fileDeleteAll').checked = false;
    document.getElementById('filePatternsContainer').classList.add('hidden');
    document.getElementById('fileKeepPattern').value = '';

    modal.classList.remove('hidden');

    const closeModal = () => modal.classList.add('hidden');
    cancelBtn.onclick = closeModal;
    closeBtn.onclick = closeModal;

    const cleanConfirmBtn = confirmBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(cleanConfirmBtn, confirmBtn);

    cleanConfirmBtn.onclick = async () => {
        const pipelineIdentifier = modalPipelineSelectEl.value;
        if (!pipelineIdentifier) {
            showToast("You must select a pipeline to run.", "warning");
            return;
        }

        const keepMode = document.querySelector('input[name="fileKeepMode"]:checked').value;
        const patterns = document.getElementById('fileKeepPattern').value.trim();

        if (keepMode === 'pattern' && !patterns) {
            showToast("Please provide at least one file pattern.", "warning");
            return;
        }
        
        const isSandbox = uploadsEnvToggleEl.value === 'sandbox';
        const fileManifest = {
            keep_mode: keepMode,
            patterns: patterns.split('\n').map(p => p.trim()).filter(Boolean)
        };

        closeModal();

        // Execute for each selected concept
        for (const conceptId of selectedConceptIds) {
            await executePipelineForRecords(pipelineIdentifier, [], conceptId, fileManifest, isSandbox);
        }
    };
}

function openNewVersionFromFileModal() {
    newVersionFromFileStep1.classList.remove('hidden');
    newVersionFromFileStep2.classList.add('hidden');
    scanFilesForMatchesBtn.classList.remove('hidden');
    proceedToVersioningBtn.classList.add('hidden');
    backToStep1Btn.classList.add('hidden');
    newVersionDirectoryPath.value = '';
    matchedRecordsContainer.innerHTML = '';
    processingModeRoot.checked = true;
    rootOptionsContainer.classList.remove('hidden');
    subdirectoryMessage.classList.add('hidden');

    newVersionFromFileModal.classList.remove('hidden');
}

async function handleScanForMatches() {
    const directoryPath = newVersionDirectoryPath.value;
    const processingMode = document.querySelector('input[name="processingMode"]:checked').value;
    const matchingMethod = document.querySelector('input[name="matchingMethod"]:checked').value;

    if (!directoryPath) {
        showToast("Please select an input directory.", "warning");
        return;
    }

    if (processingMode === 'subdirectory') {
        showToast("Subdirectory mode is not yet implemented.", "info");
        return;
    }

    if (loader) {
        loader.style.display = 'block';
    }
    scanFilesForMatchesBtn.disabled = true;

    try {
        const response = await fetch(`${PYTHON_API_BASE_URL}/api/project/match_files_for_versioning`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                directory_path: directoryPath,
                match_method: matchingMethod
            })
        });

        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Failed to scan for matches.');

        renderMatchedRecords(result.matches);
        newVersionFromFileStep1.classList.add('hidden');
        newVersionFromFileStep2.classList.remove('hidden');
        scanFilesForMatchesBtn.classList.add('hidden');
        proceedToVersioningBtn.classList.remove('hidden');
        backToStep1Btn.classList.remove('hidden');

    } catch (error) {
        showToast(`Error: ${error.message}`, "error");
    } finally {
        if (loader) {
            loader.style.display = 'none';
        }
        scanFilesForMatchesBtn.disabled = false;
    }
}

function renderMatchedRecords(matches) {
    if (matches.length === 0) {
        matchedRecordsContainer.innerHTML = '<p class="p-4 text-center text-gray-500">No matching records found in the HDPC for the files in the selected directory.</p>';
        return;
    }

    matchedRecordsContainer.innerHTML = matches.map(match => `
        <div class="p-3 border-b border-gray-200" title="${match.matched_file_path}">
            <div class="flex items-center">
                <input type="checkbox" class="matched-record-checkbox mr-3 h-4 w-4" data-concept-id="${match.concept_rec_id}" data-new-source-path="${match.matched_file_path}" checked>
                <div>
                    <p class="font-medium text-sm">${match.record_title}</p>
                    <p class="text-xs text-gray-600">Matched file: <code class="text-xs bg-gray-100 p-0.5 rounded">${match.matched_file_path.split(/[/\\]/).pop()}</code></p>
                    <p class="text-xs text-gray-500">Concept ID: ${match.concept_rec_id}</p>
                </div>
            </div>
        </div>
    `).join('');
}

async function promptForPipelineSelection() {
    return new Promise((resolve) => {
        const modal = document.getElementById('pipelineSelectionPromptModal');
        const selectEl = document.getElementById('pipelineSelectionPromptSelect');
        const confirmBtn = document.getElementById('confirmPipelineSelectionBtn');
        const cancelBtn = document.getElementById('cancelPipelineSelectionBtn');
        const closeBtn = document.getElementById('closePipelineSelectionPromptModal');

        if (!modal || !selectEl || !confirmBtn || !cancelBtn || !closeBtn) {
            console.error('Pipeline selection prompt modal elements not found!');
            resolve(null); // Resolve with null if the modal isn't set up
            return;
        }

        // Populate the dropdown with available pipelines
        selectEl.innerHTML = '<option value="">-- Select a Pipeline --</option>';
        availablePipelines.forEach(p => {
            selectEl.innerHTML += `<option value="${p.identifier}">${p.name}</option>`;
        });

        const closeModal = () => {
            modal.classList.add('hidden');
            // Clean up listeners to prevent memory leaks
            cleanConfirmBtn.removeEventListener('click', onConfirm);
            cancelBtn.removeEventListener('click', onCancel);
            closeBtn.removeEventListener('click', onCancel);
        };

        const onConfirm = () => {
            const selectedPipeline = selectEl.value;
            if (!selectedPipeline) {
                showToast("Please select a pipeline.", "warning");
                return;
            }
            resolve(selectedPipeline);
            closeModal();
        };

        const onCancel = () => {
            resolve(null); // Resolve with null if the user cancels
            closeModal();
        };

        const cleanConfirmBtn = confirmBtn.cloneNode(true);
        confirmBtn.parentNode.replaceChild(cleanConfirmBtn, confirmBtn);

        cleanConfirmBtn.addEventListener('click', onConfirm);
        cancelBtn.addEventListener('click', onCancel);
        closeBtn.addEventListener('click', onCancel);

        modal.classList.remove('hidden');
    });
}