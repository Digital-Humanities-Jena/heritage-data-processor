// src/renderer/js/wizards/newProjectWizard.js

import { PYTHON_API_BASE_URL, fetchAndDisplayAllDataFromBackend } from '../core/api.js';
import { setProjectContext } from '../core/state.js';
import { showToast, loader } from '../core/ui.js';
import { navigateToView } from '../core/navigation.js';
import { addToLog } from '../renderer.js';

// --- DOM Elements ---
const createNewProjectBtn = document.getElementById('createNewProjectBtn');
const newProjectModal = document.getElementById('newProjectModal');
const newProjectModalTitle = document.getElementById('newProjectModalTitle');
const closeNewProjectModalBtn = document.getElementById('closeNewProjectModalBtn');
const newProjectModalBody = document.getElementById('newProjectModalBody');

const newProjectStep1 = document.getElementById('newProjectStep1');
const newProjectNameInput = document.getElementById('newProjectName');
const newProjectShortCodeInput = document.getElementById('newProjectShortCode');
const newProjectShortCodeHelp = document.getElementById('newProjectShortCodeHelp');
const suggestedHdpcFilenameEl = document.getElementById('suggestedHdpcFilename');

const newProjectStep2 = document.getElementById('newProjectStep2');
const chosenHdpcPathDisplay = document.getElementById('chosenHdpcPathDisplay');
const newProjectModalitySelect = document.getElementById('newProjectModality');

const newProjectStep3 = document.getElementById('newProjectStep3');
const configPathsForProjectNameEl = document.getElementById('configPathsForProjectName');
const newProjectDataInPathInput = document.getElementById('newProjectDataInPath');
const browseDataInPathBtn = document.getElementById('browseDataInPathBtn');
const newProjectDataOutPathInput = document.getElementById('newProjectDataOutPath');
const browseDataOutPathBtn = document.getElementById('browseDataOutPathBtn');
const newProjectBatchEntitySelect = document.getElementById('newProjectBatchEntity');
const dataInScanResultEl = document.getElementById('dataInScanResult');

const newProjectStep4 = document.getElementById('newProjectStep4');
const scanSettingsModality = document.getElementById('scanSettingsModality');
const fileExtensionCheckboxes = document.getElementById('fileExtensionCheckboxes');
const objOptionsContainer = document.getElementById('objOptionsContainer');
const addMtlFile = document.getElementById('addMtlFile');
const addTextureFiles = document.getElementById('addTextureFiles');
const textureSearchContainer = document.getElementById('textureSearchContainer');
const textureSearchDirsContainer = document.getElementById('textureSearchDirsContainer');
const addTextureDirBtn = document.getElementById('addTextureDirBtn');
const archiveSubdirectories = document.getElementById('archiveSubdirectories');
const bundlingOptionsContainer = document.getElementById('bundlingOptionsContainer');
const bundleCongruentPatterns = document.getElementById('bundleCongruentPatterns');
const primarySourceFileContainer = document.getElementById('primarySourceFileContainer');
const primarySourceFileSelect = document.getElementById('primarySourceFileSelect');

const newProjectStep5 = document.getElementById('newProjectStep5');
const foundFilesListContainer = document.getElementById('foundFilesListContainer');
const fileStatusModal = document.getElementById('fileStatusModal');
const closeFileStatusModalBtn = document.getElementById('closeFileStatusModalBtn');
const closeFileStatusModalFooterBtn = document.getElementById('closeFileStatusModalFooterBtn');
const fileStatusModalTitle = document.getElementById('fileStatusModalTitle');
const fileStatusModalBody = document.getElementById('fileStatusModalBody');

const newProjectStep6 = document.getElementById('newProjectStep6');
const newProjectSummaryText = document.getElementById('newProjectSummaryText');
const newProjectStatus = document.getElementById('newProjectStatus');
const newProjectBackBtn = document.getElementById('newProjectBackBtn');
const newProjectNextBtn = document.getElementById('newProjectNextBtn');
const newProjectFinishBtn = document.getElementById('newProjectFinishBtn');

// --- State & Constants ---
let currentNewProjectStep = 1;
let newProjectData = {};
let foundFilesCache = {};
const VALID_FILENAME_REGEX = /^[a-zA-Z0-9_-]+$/;
const MODALITY_OPTIONS = [
    { key: "Image / Photography", label: "Image / Photography" },
    { key: "3D Model", label: "3D Model" },
    { key: "Audio", label: "Audio" },
    { key: "Video", label: "Video" },
    { key: "Text / Document", label: "Text / Document" },
    { key: "Software", label: "Software" },
    { key: "Structured", label: "Structured Information" },
    { key: "Multimodal", label: "Multimodal Dataset" },
];

// --- Core Functions ---

function resetNewProjectWizard() {
    currentNewProjectStep = 1;
    newProjectData = {
        projectName: '', shortCode: '', hdpcPath: '', modalities: [], projectId: null,
        dataInPath: '', dataOutPath: '', batchEntity: 'root', scanOptions: {}
    };
    if (newProjectNameInput) newProjectNameInput.value = '';
    if (newProjectShortCodeInput) newProjectShortCodeInput.value = '';
    if (suggestedHdpcFilenameEl) suggestedHdpcFilenameEl.textContent = 'project.hdpc';

    if (newProjectModalitySelect) {
        newProjectModalitySelect.innerHTML = MODALITY_OPTIONS.map(m => 
            `<div class="modality-tag" data-value="${m.key}">${m.label}</div>`
        ).join('');
    }

    if (newProjectDataInPathInput) newProjectDataInPathInput.value = '';
    if (newProjectDataOutPathInput) newProjectDataOutPathInput.value = '';
    if (newProjectStatus) newProjectStatus.textContent = '';
}

function updateObjOptionsVisibility() {
    const is3DModel = newProjectData.modalities.includes('3D Model');
    const objCheckbox = document.getElementById('ext-.obj');
    const isObjSelected = objCheckbox ? objCheckbox.checked : false;

    if (is3DModel && isObjSelected) {
        objOptionsContainer.classList.remove('hidden');
    } else {
        objOptionsContainer.classList.add('hidden');
        addMtlFile.checked = false;
        addTextureFiles.checked = false;
        addTextureFiles.disabled = true;
        textureSearchContainer.style.opacity = '0.5';
        addTextureDirBtn.disabled = true;
        textureSearchDirsContainer.querySelectorAll('.user-added-dir').forEach(el => el.remove());
    }

    if (archiveSubdirectories) {
        archiveSubdirectories.checked = true;
    }
}

function updatePrimarySourceFileDropdown() {
    const selectedExtensions = Array.from(fileExtensionCheckboxes.querySelectorAll('.file-ext-checkbox:checked')).map(cb => cb.value);
    let optionsHTML = '<option value="">- None -</option>';
    const savedPrimaryExt = newProjectData.scanOptions?.primary_source_ext;

    optionsHTML += selectedExtensions.map(ext => 
        `<option value="${ext}" ${savedPrimaryExt === ext ? 'selected' : ''}>${ext}</option>`
    ).join('');

    primarySourceFileSelect.innerHTML = optionsHTML;

    // After populating, ensure the search term is re-applied if it exists
    const primarySourceFileSearch = document.getElementById('primarySourceFileSearch');
    if (primarySourceFileSearch && primarySourceFileSearch.value) {
        primarySourceFileSearch.dispatchEvent(new Event('input'));
    }
}

async function updateNewProjectWizardView() {
    document.querySelectorAll('.new-project-step').forEach(stepEl => stepEl.classList.add('hidden'));
    if (newProjectModalTitle) newProjectModalTitle.textContent = "Create New Project";

    switch (currentNewProjectStep) {
        case 1:
            if (newProjectStep1) newProjectStep1.classList.remove('hidden');
            if (newProjectModalTitle) newProjectModalTitle.textContent = "Step 1: Project Details";
            if (newProjectBackBtn) newProjectBackBtn.classList.add('hidden');
            if (newProjectNextBtn) { newProjectNextBtn.classList.remove('hidden'); newProjectNextBtn.textContent = "Next: Choose Save Location"; }
            if (newProjectFinishBtn) newProjectFinishBtn.classList.add('hidden');
            break;

        case 2:
            if (newProjectStep2) newProjectStep2.classList.remove('hidden');
            if (newProjectModalTitle) newProjectModalTitle.textContent = "Step 2: Select Modality Templates";
            if (chosenHdpcPathDisplay) chosenHdpcPathDisplay.textContent = newProjectData.hdpcPath || 'Not selected';
            if (newProjectBackBtn) newProjectBackBtn.classList.remove('hidden');
            if (newProjectNextBtn) { newProjectNextBtn.classList.remove('hidden'); newProjectNextBtn.textContent = "Next: Configure Paths"; }
            if (newProjectFinishBtn) newProjectFinishBtn.classList.add('hidden');
            break;

        case 3:
            if (newProjectStep3) newProjectStep3.classList.remove('hidden');
            if (newProjectModalTitle) newProjectModalTitle.textContent = `Step 3: Configure Data Paths for '${newProjectData.projectName}'`;
            if (newProjectData.hdpcPath && newProjectDataInPathInput && !newProjectDataInPathInput.value) {
                const separator = newProjectData.hdpcPath.includes('\\') ? '\\' : '/';
                const hdpcDir = newProjectData.hdpcPath.substring(0, newProjectData.hdpcPath.lastIndexOf(separator));
                newProjectDataInPathInput.placeholder = `e.g., ${hdpcDir}${separator}Data${separator}${newProjectData.shortCode}${separator}Input`;
                newProjectDataOutPathInput.placeholder = `e.g., ${hdpcDir}${separator}Data${separator}${newProjectData.shortCode}${separator}Output`;
            }
            if (newProjectBatchEntitySelect) {
                 newProjectBatchEntitySelect.innerHTML = `
                    <option value="root">Root (each file for a separate Zenodo record)</option>
                    <option value="subdirectory">Subdirectory (each subfolder becomes a separate Zenodo record)</option>
                    <option value="hybrid">Hybrid (Root and Subdirectory)</option>
                `;
                // restore recently set state
                newProjectBatchEntitySelect.value = newProjectData.batchEntity || 'root';
            }
            if (newProjectBackBtn) newProjectBackBtn.classList.remove('hidden');
            if (newProjectNextBtn) { newProjectNextBtn.classList.remove('hidden'); newProjectNextBtn.textContent = "Next: Configure Scan Options"; }
            if (newProjectFinishBtn) newProjectFinishBtn.classList.add('hidden');
            break;
            
        case 4:
            if (newProjectStep4) newProjectStep4.classList.remove('hidden');
            const selectedModalities = newProjectData.modalities || [];
            const modalityLabel = selectedModalities.join(' & ');

            if (newProjectModalTitle) newProjectModalTitle.textContent = `Step 4: File Scan Options for '${modalityLabel}'`;
            if (scanSettingsModality) scanSettingsModality.textContent = modalityLabel;

            textureSearchDirsContainer.innerHTML = '';
            const defaultDirDiv = document.createElement('div');
            defaultDirDiv.className = 'flex items-center gap-2';
            defaultDirDiv.innerHTML = `
                <input type="text" class="texture-dir-path flex-grow p-1.5 border rounded-md bg-gray-100 text-sm" value="${newProjectData.dataInPath}" readonly title="Input Data Directory (always included)">
                <button type="button" class="btn-icon-disabled" disabled title="The main input directory cannot be removed.">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                </button>
            `;
            textureSearchDirsContainer.appendChild(defaultDirDiv);
            try {
                const response = await fetch(`${PYTHON_API_BASE_URL}/api/config/get`);
                const configData = await response.json();
                const allFilters = configData.configData.modality_file_filters;

                fileExtensionCheckboxes.innerHTML = '';

                selectedModalities.forEach(modalityKey => {
                    const filters = allFilters[modalityKey];
                    if (filters && filters.accepted_extensions) {
                        const details = document.createElement('details');
                        details.className = 'modality-group p-2 border-b last:border-b-0';
                        details.open = true; // Default to open
                        
                        const summary = document.createElement('summary');
                        summary.className = 'font-semibold text-sm cursor-pointer';
                        summary.textContent = modalityKey;
                        details.appendChild(summary);

                        const extensionGrid = document.createElement('div');
                        extensionGrid.className = 'grid grid-cols-3 gap-2 mt-2 pl-4';
                        
                        filters.accepted_extensions.forEach(ext => {
                            const isChecked = newProjectData.scanOptions?.extensions?.includes(ext) ?? true;
                            const div = document.createElement('div');
                            div.className = 'flex items-center';
                            div.innerHTML = `
                                <input id="ext-${ext}" type="checkbox" value="${ext}" class="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 file-ext-checkbox" ${isChecked ? 'checked' : ''}>
                                <label for="ext-${ext}" class="ml-2 text-sm text-gray-600">${ext}</label>
                            `;
                            extensionGrid.appendChild(div);
                        });
                        details.appendChild(extensionGrid);
                        fileExtensionCheckboxes.appendChild(details);
                    }
                });

                // Re-attach the event listener after populating
                fileExtensionCheckboxes.addEventListener('change', () => {
                    updateObjOptionsVisibility();
                    updatePrimarySourceFileDropdown();
                });

                // Manually trigger the update functions to set the initial state correctly
                updateObjOptionsVisibility();
                updatePrimarySourceFileDropdown();

            } catch (error) {
                console.error("Could not load modality filters:", error);
                fileExtensionCheckboxes.innerHTML = '<p class="text-red-500 text-sm">Could not load file extensions.</p>';
            }

            if (newProjectBackBtn) newProjectBackBtn.classList.remove('hidden');
            if (newProjectNextBtn) { newProjectNextBtn.classList.remove('hidden'); newProjectNextBtn.textContent = "Create Project & Scan Files"; }
            if (newProjectFinishBtn) newProjectFinishBtn.classList.add('hidden');
            break;

        case 5:
            if (newProjectStep5) newProjectStep5.classList.remove('hidden');
            if (newProjectModalTitle) newProjectModalTitle.textContent = "Step 5: Review Found Files";
            renderFoundFilesList(newProjectData.foundFiles || []);
            if (newProjectBackBtn) newProjectBackBtn.classList.remove('hidden');
            if (newProjectNextBtn) { newProjectNextBtn.classList.remove('hidden'); newProjectNextBtn.textContent = "Next: Finish"; }
            if (newProjectFinishBtn) newProjectFinishBtn.classList.add('hidden');
            break;

        case 6:
            if (newProjectStep6) newProjectStep6.classList.remove('hidden');
            if (newProjectModalTitle) newProjectModalTitle.textContent = "Project Creation Complete!";
            if (newProjectSummaryText) newProjectSummaryText.textContent = `Project '${newProjectData.projectName}' created successfully! ${newProjectData.foundFiles.length || 0} files were added.`;
            if (newProjectBackBtn) newProjectBackBtn.classList.add('hidden');
            if (newProjectNextBtn) newProjectNextBtn.classList.add('hidden');
            if (newProjectFinishBtn) newProjectFinishBtn.classList.remove('hidden');
            break;
    }
    if (newProjectStatus) newProjectStatus.textContent = '';
}

async function handleNewProjectNext() {
    if (newProjectStatus) newProjectStatus.textContent = '';

    if (currentNewProjectStep === 1) {
        newProjectData.projectName = newProjectNameInput.value.trim();
        newProjectData.shortCode = newProjectShortCodeInput.value.trim();
        if (!newProjectData.projectName || !newProjectData.shortCode) {
            if (newProjectStatus) newProjectStatus.textContent = "Project Name and Short Code cannot be empty.";
            return;
        }
        if (!VALID_FILENAME_REGEX.test(newProjectData.shortCode)) {
            if (newProjectStatus) newProjectStatus.textContent = "Short Code contains invalid characters.";
            return;
        }
        const result = await window.electronAPI.saveHdpcDialog({ defaultFilename: `${newProjectData.shortCode}.hdpc` });
        if (result.canceled || !result.filePath) return;
        newProjectData.hdpcPath = result.filePath;
        currentNewProjectStep = 2;

    } else if (currentNewProjectStep === 2) {
        newProjectData.modalities = Array.from(document.querySelectorAll('#newProjectModality .modality-tag.selected')).map(tag => tag.dataset.value);
        if (newProjectData.modalities.length === 0) {
            if (newProjectStatus) newProjectStatus.textContent = "Please select at least one modality.";
            return;
        }
        currentNewProjectStep = 3;

    } else if (currentNewProjectStep === 3) {
        newProjectData.dataInPath = newProjectDataInPathInput.value.trim();
        newProjectData.dataOutPath = newProjectDataOutPathInput.value.trim();
        newProjectData.batchEntity = newProjectBatchEntitySelect.value;
        if (!newProjectData.dataInPath || !newProjectData.dataOutPath) {
            if (newProjectStatus) newProjectStatus.textContent = "Input and Output directories must be specified.";
            return;
        }
        currentNewProjectStep = 4;

    } else if (currentNewProjectStep === 4) {
        const selectedExtensions = Array.from(fileExtensionCheckboxes.querySelectorAll('.file-ext-checkbox:checked')).map(cb => cb.value);
        if (selectedExtensions.length === 0) {
            if (newProjectStatus) newProjectStatus.textContent = "Please select at least one file extension to scan for.";
            return;
        }
        const textureSearchPaths = Array.from(textureSearchDirsContainer.querySelectorAll('.texture-dir-path')).map(input => input.value);
        
        newProjectData.scanOptions = {
            extensions: selectedExtensions,
            primary_source_ext: primarySourceFileSelect.value,
            bundle_congruent_patterns: bundleCongruentPatterns.checked,
            obj_options: {
                add_mtl: addMtlFile.checked,
                add_textures: addTextureFiles.checked,
                texture_search_paths: addTextureFiles.checked ? textureSearchPaths : [],
                archive_subdirectories: archiveSubdirectories.checked
            }
        };

        if (loader) loader.style.display = 'block';
        try {
            const response = await fetch(`${PYTHON_API_BASE_URL}/api/project/create_and_scan`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(newProjectData)
            });
            const result = await response.json();
            if (!response.ok || !result.success) {
                throw new Error(result.error || "Failed to create project or scan files.");
            }
            newProjectData.projectId = result.projectId;
            newProjectData.foundFiles = result.foundFiles || [];
            currentNewProjectStep = 5;
        } catch (error) {
            if (newProjectStatus) newProjectStatus.textContent = `Error: ${error.message}`;
            return;
        } finally {
            if (loader) loader.style.display = 'none';
        }
    
    } else if (currentNewProjectStep === 5) {
        currentNewProjectStep = 6;
    }

    updateNewProjectWizardView();
}

function handleNewProjectBack() {
    if (currentNewProjectStep > 1) {
        currentNewProjectStep--;
        updateNewProjectWizardView();
    }
}

async function handleNewProjectFinish() {
    if (!newProjectData.hdpcPath) return;
    if (loader) loader.style.display = 'block';
    if (newProjectModal) newProjectModal.classList.add('hidden');
    addToLog('New Project', `Finished wizard. Loading new project: ${newProjectData.hdpcPath}`);
    
    try {
        // 1. Tell the backend to load the newly created project file
        const response = await fetch(`${PYTHON_API_BASE_URL}/api/hdpc/load`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: newProjectData.hdpcPath })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to load new project file on the backend.');
        }
        
        const loadResult = await response.json(); // This contains the authoritative project details

        // 2. Update UI elements
        const fileNameDisplay = document.getElementById('fileName');
        if (fileNameDisplay) fileNameDisplay.textContent = newProjectData.hdpcPath.split(/[/\\]/).pop();
        showToast(`Project '${loadResult.project_name}' loaded.`, 'success');
        
        if (!loadResult.project_id) {
            throw new Error("Project loaded, but the backend did not return a valid project ID.");
        }
        setProjectContext(newProjectData.hdpcPath, loadResult.project_id);
        
        // 4. Fetch all data for the newly loaded project and navigate
        await fetchAndDisplayAllDataFromBackend();
        navigateToView('dashboard');

    } catch (error) {
        addToLog('New Project', `Error loading new project: ${error.message}`);
        showToast(`Error: ${error.message}`, "error");
    } finally {
        if (loader) loader.style.display = 'none';
    }
}

/**
 * Adds a new, removable directory row to the texture search path list.
 * @param {string} path The directory path to add.
 */
function addTextureDirectoryRow(path) {
    const div = document.createElement('div');
    div.className = 'flex items-center gap-2 user-added-dir';
    div.innerHTML = `
        <input type="text" class="texture-dir-path flex-grow p-1.5 border rounded-md bg-white text-sm" value="${path}" readonly>
        <button type="button" class="remove-texture-dir-btn btn-icon text-red-500 hover:bg-red-100" title="Remove directory">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
        </button>
    `;
    textureSearchDirsContainer.appendChild(div);
}

/**
 * Recursively renders a file and its children with appropriate indentation.
 * @param {object} file - The file object from the backend.
 * @param {number} level - The current indentation level.
 * @returns {string} The HTML string for the file and its descendants.
 */
function createFileRowHTML(file, level) {
    const indent = level * 20; // 20px indent per level
    const iconMap = {
        source: '<svg class="w-4 h-4 text-blue-600 mr-2 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"></path></svg>',
        primary: '<svg class="w-4 h-4 text-green-600 mr-2 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>',
        primary_source: '<svg class="w-4 h-4 text-yellow-500 mr-2 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"></path></svg>',
        secondary: '<svg class="w-4 h-4 text-gray-500 mr-2 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14z"></path></svg>',
        archive: '<svg class="w-4 h-4 text-indigo-600 mr-2 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4m-4-4h4m-4 8h4m-7 0h.01M9 3h6a2 2 0 012 2v3H7V5a2 2 0 012-2z"></path></svg>',
        archived_file: '<svg class="w-4 h-4 text-indigo-400 mr-2 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"></path></svg>'
    };
    const icon = iconMap[file.type] || iconMap['source'];

    const statusClasses = {
        "Valid": "text-green-600 hover:text-green-800", "Invalid": "text-red-600 hover:text-red-800",
        "Problems": "text-red-600 hover:text-red-800 font-bold", "MTL Missing": "text-amber-600 hover:text-amber-800",
        "Textures Missing": "text-amber-600 hover:text-amber-800", "File Conflict": "text-purple-600 hover:text-purple-800 font-bold",
        "Pending": "text-blue-600 hover:text-blue-800"
    };
    const statusClass = statusClasses[file.status] || "text-gray-600";
    const fileId = file.path; 
    
    const primarySourceTag = file.type === 'primary_source' 
        ? `<span class="ml-2 text-xs font-semibold text-white bg-yellow-500 px-2 py-0.5 rounded-full">Primary Source</span>`
        : '';

    const archiveInfo = file.type === 'archived_file' 
        ? `<span class="ml-2 text-xs italic text-indigo-700">(archived in ${file.archive_name || 'archive.zip'})</span>`
        : '';
    
    const separator = file.path.includes('\\') ? '\\' : '/';
    const pathParts = file.path.split(separator);
    const parentDir = pathParts.length > 1 ? pathParts[pathParts.length - 2] : '';
    const displayPath = parentDir ? `...${separator}${parentDir}${separator}${file.name}` : file.name;

    let rowHTML = `
        <div class="flex items-center py-1.5 text-sm">
            <div class="flex-grow flex items-center min-w-0" style="padding-left: ${indent}px;">
                ${icon}
                <span class="text-gray-800 truncate" title="${file.path}">${displayPath}</span>
                ${primarySourceTag} 
                ${archiveInfo}
            </div>
            <div class="w-24 text-center flex-shrink-0">
                <button class="status-btn hover:underline text-xs font-medium ${statusClass}" data-file-id="${fileId}">
                    ${file.status}
                </button>
            </div>
        </div>
    `;

    if (file.children && file.children.length > 0) {
        rowHTML += file.children.map(child => createFileRowHTML(child, level + 1)).join('');
    }
    return rowHTML;
}

/**
 * Renders the entire list of found files into the container.
 * @param {Array<object>} files - The array of file objects from the backend.
 */
function renderFoundFilesList(files) {
    foundFilesListContainer.innerHTML = '';
    foundFilesCache = {};

    if (!files || files.length === 0) {
        foundFilesListContainer.innerHTML = '<p class="text-sm text-gray-500 text-center py-4">No files found.</p>';
        return;
    }

    // A function to traverse the file tree and populate the cache
    function populateCache(fileNode) {
        foundFilesCache[fileNode.path] = fileNode;
        if (fileNode.children) {
            fileNode.children.forEach(populateCache);
        }
    }

    files.forEach(populateCache);

    // Wrap each bundle / record in a styled container
    const bundlesHTML = files.map(file => {
        return `
            <div class="file-bundle border-b-2 border-gray-200 last:border-b-0 py-2">
                ${createFileRowHTML(file, 0)}
            </div>
        `;
    }).join('');
    
    foundFilesListContainer.innerHTML = bundlesHTML;
}

/**
 * Opens and populates the file status modal with validation details.
 * @param {object} fileData The full file object, including validation_report.
 */
function openStatusModal(fileData) {
    if (!fileStatusModal || !fileStatusModalTitle || !fileStatusModalBody) return;

    fileStatusModalTitle.textContent = `Status Report: ${fileData.name}`;
    
    let bodyHTML = `
        <div>
            <h4 class="font-semibold text-gray-800">File Path</h4>
            <p class="font-mono text-xs bg-gray-100 p-2 rounded mt-1 break-all">${fileData.path}</p>
        </div>
    `;

    const report = fileData.validation_report;
    if (report) {
        if (report.conflicts && report.conflicts.length > 0) {
            bodyHTML += `
                <div>
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
                <div>
                    <h4 class="font-semibold text-red-700">Validation Issues</h4>
                    <ul class="list-disc list-inside text-sm text-red-600 mt-1 space-y-1">
                        ${report.errors.map(err => `<li>${err}</li>`).join('')}
                    </ul>
                </div>
            `;
        } else {
             bodyHTML += `
                <div>
                    <h4 class="font-semibold text-green-700">Validation Status</h4>
                    <p class="text-sm text-gray-700 mt-1">File appears to be valid and readable.</p>
                </div>
            `;
        }

        if (report.missing_textures && report.missing_textures.length > 0) {
            bodyHTML += `
                <div>
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
                <div>
                    <h4 class="font-semibold text-gray-800 mt-3">Validation Details</h4>
                    <div class="text-sm text-gray-700 mt-1 bg-gray-50 p-2 rounded border">
                        ${Object.entries(report.details).map(([key, value]) => `<p><strong>${key.replace(/_/g, ' ')}:</strong> ${value}</p>`).join('')}
                    </div>
                </div>
            `;
        }
    }

    fileStatusModalBody.innerHTML = bodyHTML;
    fileStatusModal.classList.remove('hidden');
}

// --- Initialization ---
export function initNewProjectWizard() {
    if (createNewProjectBtn) {
        createNewProjectBtn.addEventListener('click', () => {
            resetNewProjectWizard();
            updateNewProjectWizardView();
            if (newProjectModal) newProjectModal.classList.remove('hidden');
        });
    }
    if (closeNewProjectModalBtn) closeNewProjectModalBtn.addEventListener('click', () => newProjectModal.classList.add('hidden'));
    if (newProjectNextBtn) newProjectNextBtn.addEventListener('click', handleNewProjectNext);
    if (newProjectBackBtn) newProjectBackBtn.addEventListener('click', handleNewProjectBack);
    if (newProjectFinishBtn) newProjectFinishBtn.addEventListener('click', handleNewProjectFinish);

    if (newProjectModalitySelect) {
        newProjectModalitySelect.addEventListener('click', (e) => {
            if (e.target.classList.contains('modality-tag')) {
                e.target.classList.toggle('selected');
            }
        });
    }

    if (newProjectShortCodeInput) {
        newProjectShortCodeInput.addEventListener('input', () => {
            const code = newProjectShortCodeInput.value.trim();
            if (VALID_FILENAME_REGEX.test(code) || code === '') {
                suggestedHdpcFilenameEl.textContent = code ? `${code}.hdpc` : 'project.hdpc';
                newProjectShortCodeHelp.classList.remove('text-red-500');
            } else {
                suggestedHdpcFilenameEl.textContent = 'invalid_code.hdpc';
                newProjectShortCodeHelp.classList.add('text-red-500');
            }
        });
    }

    if (browseDataInPathBtn) {
        browseDataInPathBtn.addEventListener('click', async () => {
            const path = await window.electronAPI.openDirectory();
            if (path) newProjectDataInPathInput.value = path;
        });
    }
    if (browseDataOutPathBtn) {
        browseDataOutPathBtn.addEventListener('click', async () => {
            const path = await window.electronAPI.openDirectory();
            if (path) newProjectDataOutPathInput.value = path;
        });
    }

    if (fileExtensionCheckboxes) {
        fileExtensionCheckboxes.addEventListener('change', () => {
            updateObjOptionsVisibility();
            updatePrimarySourceFileDropdown();
        });
    }

    if (addMtlFile) {
        addMtlFile.addEventListener('change', () => {
            addTextureFiles.disabled = !addMtlFile.checked;
            if (!addMtlFile.checked) {
                addTextureFiles.checked = false;
            }
            // Trigger a change on addTextureFiles to update the third checkbox
            addTextureFiles.dispatchEvent(new Event('change'));
        });
    }

    if (addTextureFiles) {
        addTextureFiles.addEventListener('change', () => {
            const isEnabled = addTextureFiles.checked;
            textureSearchContainer.style.opacity = isEnabled ? '1' : '0.5';
            addTextureDirBtn.disabled = !isEnabled;

            if (!isEnabled) {
                // Remove any user-added directories if the option is disabled
                textureSearchDirsContainer.querySelectorAll('.user-added-dir').forEach(el => el.remove());
            }
        });
    }

    if (addTextureDirBtn) {
        addTextureDirBtn.addEventListener('click', async () => {
            const path = await window.electronAPI.openDirectory();
            if (path) {
                addTextureDirectoryRow(path);
            }
        });
    }

    if (textureSearchDirsContainer) {
        textureSearchDirsContainer.addEventListener('click', (event) => {
            const removeBtn = event.target.closest('.remove-texture-dir-btn');
            if (removeBtn) {
                removeBtn.closest('.user-added-dir').remove();
            }
        });
    }

    if (foundFilesListContainer) {
        foundFilesListContainer.addEventListener('click', (event) => {
            const statusBtn = event.target.closest('.status-btn');
            if (statusBtn) {
                const fileId = statusBtn.dataset.fileId;
                // Look up the full file object from the cache
                const fileData = foundFilesCache[fileId];
                if (fileData) {
                    openStatusModal(fileData);
                } else {
                    console.error("Could not find file data in cache for ID:", fileId);
                    showToast("Could not retrieve file details.", "error");
                }
            }
        });
    }

    if (closeFileStatusModalBtn) {
    closeFileStatusModalBtn.addEventListener('click', () => fileStatusModal.classList.add('hidden'));
    }
    if (closeFileStatusModalFooterBtn) {
        closeFileStatusModalFooterBtn.addEventListener('click', () => fileStatusModal.classList.add('hidden'));
    }

    const primarySourceFileSearch = document.getElementById('primarySourceFileSearch');
    if (primarySourceFileSearch) {
        primarySourceFileSearch.addEventListener('input', () => {
            const searchTerm = primarySourceFileSearch.value.toLowerCase().replace('.', '');
            const options = primarySourceFileSelect.options;
            let visibleOptionsCount = 0;
            for (let i = 0; i < options.length; i++) {
                const option = options[i];
                const optionText = option.text.toLowerCase();
                const isVisible = option.value === "" || optionText.includes(searchTerm);
                option.style.display = isVisible ? '' : 'none';
                if (isVisible) visibleOptionsCount++;
            }
            if (searchTerm) {
                primarySourceFileSelect.size = Math.max(2, Math.min(visibleOptionsCount, 5));
            } else {
                primarySourceFileSelect.size = 1; 
            }
        });

        primarySourceFileSearch.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                for (let i = 0; i < primarySourceFileSelect.options.length; i++) {
                    const option = primarySourceFileSelect.options[i];
                    if (option.style.display !== 'none' && option.value !== "") {
                        primarySourceFileSelect.value = option.value;
                        primarySourceFileSearch.value = option.value;
                        primarySourceFileSelect.size = 1; // Collapse the list
                        break;
                    }
                }
            }
        });
        
        primarySourceFileSelect.addEventListener('blur', () => {
            primarySourceFileSelect.size = 1;
        });
        primarySourceFileSelect.addEventListener('change', () => {
            primarySourceFileSearch.value = primarySourceFileSelect.value;
            primarySourceFileSelect.size = 1; // Collapse on selection
        });
    }
}