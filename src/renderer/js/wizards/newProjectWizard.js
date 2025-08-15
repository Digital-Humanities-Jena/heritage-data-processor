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
const newProjectSummaryText = document.getElementById('newProjectSummaryText');
const newProjectStatus = document.getElementById('newProjectStatus');
const newProjectBackBtn = document.getElementById('newProjectBackBtn');
const newProjectNextBtn = document.getElementById('newProjectNextBtn');
const newProjectFinishBtn = document.getElementById('newProjectFinishBtn');

// --- State & Constants ---
let currentNewProjectStep = 1;
let newProjectData = {};
const VALID_FILENAME_REGEX = /^[a-zA-Z0-9_-]+$/;
const MODALITY_OPTIONS = [
    "Image / Photography", "3D Model", "Audio", "Video",
    "Text / Document", "Software", "Structured Information", "Multimodal Dataset",
];

// --- Core Functions ---

function resetNewProjectWizard() {
    currentNewProjectStep = 1;
    newProjectData = { projectName: '', shortCode: '', hdpcPath: '', modality: '', projectId: null, dataInPath: '', dataOutPath: '', batchEntity: 'root' };
    if (newProjectNameInput) newProjectNameInput.value = '';
    if (newProjectShortCodeInput) newProjectShortCodeInput.value = '';
    if (suggestedHdpcFilenameEl) suggestedHdpcFilenameEl.textContent = 'project.hdpc';
    if (newProjectModalitySelect) {
        newProjectModalitySelect.innerHTML = MODALITY_OPTIONS.map(m => `<option value="${m}">${m}</option>`).join('');
    }
    if (newProjectDataInPathInput) newProjectDataInPathInput.value = '';
    if (newProjectDataOutPathInput) newProjectDataOutPathInput.value = '';
    if (newProjectStatus) newProjectStatus.textContent = '';
}

function updateNewProjectWizardView() {
    document.querySelectorAll('.new-project-step').forEach(stepEl => stepEl.classList.add('hidden'));
    if (newProjectModalTitle) newProjectModalTitle.textContent = "Create New Project";

    if (currentNewProjectStep === 1) {
        if (newProjectStep1) newProjectStep1.classList.remove('hidden');
        if (newProjectModalTitle) newProjectModalTitle.textContent = "Step 1: Project Details";
        if (newProjectBackBtn) newProjectBackBtn.classList.add('hidden');
        if (newProjectNextBtn) { newProjectNextBtn.classList.remove('hidden'); newProjectNextBtn.textContent = "Next: Choose Save Location"; }
        if (newProjectFinishBtn) newProjectFinishBtn.classList.add('hidden');
    } else if (currentNewProjectStep === 2) {
        if (newProjectStep2) newProjectStep2.classList.remove('hidden');
        if (newProjectModalTitle) newProjectModalTitle.textContent = "Step 2: Select Data Modality";
        if (chosenHdpcPathDisplay) chosenHdpcPathDisplay.textContent = newProjectData.hdpcPath || 'Not selected';
        if (newProjectBackBtn) newProjectBackBtn.classList.remove('hidden');
        if (newProjectNextBtn) { newProjectNextBtn.classList.remove('hidden'); newProjectNextBtn.textContent = "Create Project & Configure Paths"; }
        if (newProjectFinishBtn) newProjectFinishBtn.classList.add('hidden');
    } else if (currentNewProjectStep === 3) {
        if (newProjectStep3) newProjectStep3.classList.remove('hidden');
        if (newProjectModalTitle) newProjectModalTitle.textContent = `Step 3: Configure Data Paths for '${newProjectData.projectName}'`;
        if (newProjectData.hdpcPath && newProjectDataInPathInput && !newProjectDataInPathInput.value) {
            const hdpcDir = newProjectData.hdpcPath.substring(0, newProjectData.hdpcPath.lastIndexOf(window.electronAPI.isWindows ? '\\' : '/'));
             newProjectDataInPathInput.placeholder = `e.g., ${hdpcDir}/Data/${newProjectData.shortCode}/Input`;
             newProjectDataOutPathInput.placeholder = `e.g., ${hdpcDir}/Data/${newProjectData.shortCode}/Output`;
        }
        if (newProjectBackBtn) newProjectBackBtn.classList.remove('hidden');
        if (newProjectNextBtn) { newProjectNextBtn.classList.remove('hidden'); newProjectNextBtn.textContent = "Save Paths & Scan Files"; }
        if (newProjectFinishBtn) newProjectFinishBtn.classList.add('hidden');
    } else if (currentNewProjectStep === 4) {
        if (newProjectStep4) newProjectStep4.classList.remove('hidden');
        if (newProjectModalTitle) newProjectModalTitle.textContent = "Project Creation Complete!";
        if (newProjectSummaryText) newProjectSummaryText.textContent = `Project '${newProjectData.projectName}' created successfully! Files found and added.`;
        if (newProjectBackBtn) newProjectBackBtn.classList.add('hidden');
        if (newProjectNextBtn) newProjectNextBtn.classList.add('hidden');
        if (newProjectFinishBtn) newProjectFinishBtn.classList.remove('hidden');
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
        newProjectData.modality = newProjectModalitySelect.value;
        if (loader) loader.style.display = 'block';
        try {
            const response = await fetch(`${PYTHON_API_BASE_URL}/api/project/create_initial`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newProjectData)
            });
            const result = await response.json();
            if (!result.success) throw new Error(result.error || "Failed to initialize project.");
            newProjectData.projectId = result.projectId;
            showToast("Project initialized. Now configure data paths.", "success");
            currentNewProjectStep = 3;
        } catch (error) {
            if (newProjectStatus) newProjectStatus.textContent = `Error: ${error.message}`;
        } finally {
            if (loader) loader.style.display = 'none';
        }
    } else if (currentNewProjectStep === 3) {
        newProjectData.dataInPath = newProjectDataInPathInput.value.trim();
        newProjectData.dataOutPath = newProjectDataOutPathInput.value.trim();
        newProjectData.batchEntity = newProjectBatchEntitySelect.value;
        if (!newProjectData.dataInPath || !newProjectData.dataOutPath) {
            if (newProjectStatus) newProjectStatus.textContent = "Input and Output directories must be specified.";
            return;
        }
        if (loader) loader.style.display = 'block';
        try {
            const response = await fetch(`${PYTHON_API_BASE_URL}/api/project/set_paths_and_scan`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newProjectData)
            });
            const result = await response.json();
            if (!result.success) throw new Error(result.error || "Failed to save paths or scan files.");
            if (newProjectSummaryText) newProjectSummaryText.textContent = `Project '${newProjectData.projectName}' created! ${result.filesAdded || 0} files found.`;
            currentNewProjectStep = 4;
        } catch (error) {
            if (newProjectStatus) newProjectStatus.textContent = `Error: ${error.message}`;
        } finally {
            if (loader) loader.style.display = 'none';
        }
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
        const response = await fetch(`${PYTHON_API_BASE_URL}/api/hdpc/load`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: newProjectData.hdpcPath })
        });
        if (!response.ok) throw new Error((await response.json()).error || 'Failed to load new project.');
        
        const loadResult = await response.json();
        const fileNameDisplay = document.getElementById('fileName');
        if (fileNameDisplay) fileNameDisplay.textContent = newProjectData.hdpcPath.split(/[/\\]/).pop();
        showToast(`Project '${loadResult.project_name}' loaded.`, 'success');
        
        setProjectContext(newProjectData.hdpcPath, newProjectData.projectId);
        
        await fetchAndDisplayAllDataFromBackend();
        navigateToView('dashboard');
    } catch (error) {
        addToLog('New Project', `Error loading new project: ${error.message}`);
        showToast(`Error: ${error.message}`, "error");
    } finally {
        if (loader) loader.style.display = 'none';
    }
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
}