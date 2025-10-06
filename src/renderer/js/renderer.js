// src/renderer/js/renderer.js

// --- Module Imports ---
import { initSettings } from './views/settings.js';
import { initModels } from './views/models.js';
import { initOperabilityTests } from './views/operability.js';
import { initUploads } from './views/uploads.js';
import { initDashboard } from './views/dashboard.js';
import { initNewProjectWizard } from './wizards/newProjectWizard.js';
import { initMetadataMapping } from './wizards/metadataMappingWizard.js';
import { initPipelineComponents } from './views/pipelineComponents.js';
import { initNavigation, navigateToView, navigateToViewInternal } from './core/navigation.js';
import { setMainAppConfig, setProjectContext, appDataCache } from './core/state.js';
import { PYTHON_API_BASE_URL, fetchAndDisplayAllDataFromBackend } from './core/api.js';
import { setupModalBackdropClosers, showToast, resetDisplay, loader } from './core/ui.js';
import { initAlphaBlocker, applyAlphaBlockers } from './core/alphaBlocker.js';
import PipelineConstructor from './pipeline-constructor/constructor.js';
import ComponentInstallationManager from './pipeline-constructor/componentInstallationManager.js';
import ComponentRunManager from './pipeline-constructor/componentRunManager.js';

// --- Global Log ---
const globalLog = [];
export function addToLog(source, message) {
    const timestamp = new Date().toISOString();
    globalLog.push(`[${timestamp}] [${source}]\n${message}\n-----------------\n`);
}

// --- Global DOM Elements ---
const selectHdpcFileBtn = document.getElementById('selectHdpcFileBtn');
const hdpcFileUpload = document.getElementById('hdpcFileUpload');
const fileNameDisplay = document.getElementById('fileName');
const showLogBtn = document.getElementById('showLogBtn');
const logModal = document.getElementById('logModal');
const closeLogModalBtn = document.getElementById('closeLogModalBtn');
const logContent = document.getElementById('logContent');

// --- Helper Functions ---

function toObjects(queryResult) {
    if (!queryResult || queryResult.length === 0) return [];
    const [first] = queryResult;
    return first.values.map(row => first.columns.reduce((obj, col, i) => (obj[col] = row[i], obj), {}));
}

async function fetchAndDisplayAllDataFromDB(db) {
    if (!db) {
        console.error("[Renderer] Database (sql.js) not initialized for DB fetch.");
        return;
    }
    console.log("[Renderer] Fetching data from DB (sql.js mode)");
    try {
        const projectInfoData = toObjects(db.exec("SELECT project_name, description, hdpc_schema_version FROM project_info LIMIT 1;"));
        const zenodoRecordData = toObjects(db.exec("SELECT record_title, zenodo_doi, record_status, record_metadata_json, version FROM zenodo_records ORDER BY last_updated_timestamp DESC LIMIT 1;"));
        
        const filesCountResult = db.exec("SELECT COUNT(*) as count FROM source_files;");
        const filesTotal = filesCountResult[0] ? filesCountResult[0].values[0][0] : 0;
        const allFiles = toObjects(db.exec("SELECT filename, relative_path, size_bytes, mime_type, file_type, status FROM source_files ORDER BY filename;"));
        
        const apiLogCountResult = db.exec("SELECT COUNT(*) as count FROM api_log;");
        const apiLogTotal = apiLogCountResult[0] ? apiLogCountResult[0].values[0][0] : 0;

        const newCache = {
            projectInfo: projectInfoData,
            zenodoRecord: zenodoRecordData,
            filesData: { items: allFiles, totalItems: filesTotal },
            configuration: toObjects(db.exec("SELECT config_key, config_value FROM project_configuration;")),
            pipelineSteps: toObjects(db.exec("SELECT modality, component_name, component_order, is_active, parameters FROM project_pipelines ORDER BY modality, component_order;")),
            batches: toObjects(db.exec("SELECT batch_name, batch_description, status, created_timestamp FROM batches ORDER BY created_timestamp DESC;")),
            mappings: toObjects(db.exec("SELECT mapping_name, file_path, file_format, column_definitions FROM metadata_mapping_files ORDER BY mapping_name;")),
            apiLogData: { items: [], totalItems: apiLogTotal },
            credentials: toObjects(db.exec("SELECT credential_name, credential_type, is_sandbox FROM api_credentials ORDER BY credential_name;"))
        };
        
        setAppDataCache(newCache);
        
        totalFiles = newCache.filesData.totalItems;
        currentFilesData = newCache.filesData.items;
        totalApiLogEntries = newCache.apiLogData.totalItems;

        displayAllSectionsFromCache();
    } catch (e) {
        console.error("[Renderer] Error querying database with sql.js:", e);
        showToast("Error reading data from HDPC file.", "error");
    }
}

// --- Main Application Logic ---

async function handleHdpcFileSelection(filePath) {
    if (!filePath) return;

    console.log("[Renderer] File path selected:", filePath);
    if (fileNameDisplay) fileNameDisplay.textContent = filePath.split(/[/\\]/).pop();
    if (loader) loader.style.display = 'block';
    resetDisplay();

    try {
        addToLog('HDPC Load', `Attempting to load HDPC file from path: ${filePath}`);
        const loadResponse = await fetch(`${PYTHON_API_BASE_URL}/api/hdpc/load`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: filePath })
        });

        if (!loadResponse.ok) {
            const errorData = await loadResponse.json();
            throw new Error(errorData.error || `Failed to load HDPC.`);
        }
        
        const loadResult = await loadResponse.json();
        setProjectContext(filePath, loadResult.project_id); // Set state
        
        await fetchAndDisplayAllDataFromBackend();
        navigateToView('dashboard');
    } catch (error) {
        addToLog('HDPC Load', `Critical Error: ${error.message}`);
        showToast(`Error: ${error.message}.`, 'error');
        resetDisplay();
    } finally {
        if (loader) loader.style.display = 'none';
    }
}

async function initializeServerDependentComponents() {
    console.log('[Renderer] Server is ready, initializing components that depend on it.');

    // 1. Instantiate the main classes that make API calls in their constructors
    window.pipelineConstructor = new PipelineConstructor();
    window.componentInstallationManager = new ComponentInstallationManager();
    window.componentRunManager = new ComponentRunManager();

    // 2. Load the initial main application configuration from the backend
    try {
        const response = await fetch(`${PYTHON_API_BASE_URL}/api/config/get`);
        const responseData = await response.json();
        if (!response.ok) throw new Error(responseData.error || 'Failed to get config.');
        const config = responseData.configData || {};
        setMainAppConfig(responseData.configData || {}, responseData.configDirAbsPath || '');
        addToLog('App Init', 'Main application configuration loaded.');

        initAlphaBlocker(config);
        applyAlphaBlockers();
    } catch (error) {
        console.error("Error loading initial main application config:", error);
        addToLog('App Init', `Error loading main config: ${error.message}`);
    }
}

// --- Initialization ---
document.addEventListener('DOMContentLoaded', async () => {
    console.log("[Renderer] DOMContentLoaded - Initializing application modules.");

    // Initialize all UI-only feature modules first
    initSettings();
    initModels();
    initOperabilityTests();
    initUploads();
    initDashboard();
    initNewProjectWizard();
    initMetadataMapping();
    initPipelineComponents();
    initNavigation();
    
    // Setup global UI helpers that don't depend on the server
    setupModalBackdropClosers();

    // Wait for the main process to signal that the backend server is ready
    if (window.electronAPI && window.electronAPI.onServerReady) {
        window.electronAPI.onServerReady(() => {
            // This now correctly handles all server-dependent initializations
            initializeServerDependentComponents();
        });
    } else {
        // Fallback for running in a browser without Electron for testing
        console.warn("Non-Electron environment detected. Initializing server-dependent components immediately.");
        initializeServerDependentComponents();
    }
    
    // Setup logging modal
    if (showLogBtn) {
        showLogBtn.addEventListener('click', () => {
            logContent.textContent = globalLog.join('');
            if (logModal) {
                logModal.classList.remove('hidden');
            }
            logContent.scrollTop = logContent.scrollHeight;
        });
    }
    if (closeLogModalBtn) {
        closeLogModalBtn.addEventListener('click', () => {
            if (logModal) {
                logModal.classList.add('hidden');
            }
        });
    }

    // Setup unsaved changes warning
    window.addEventListener('beforeunload', (event) => {
        if (window.pipelineConstructor?.currentPipeline?.isModified) {
            event.preventDefault();
            event.returnValue = '';
        }
    });

    // Listener for the 'View All Published' button on the dashboard
    document.body.addEventListener('click', (e) => {
        // Use .closest() to handle clicks on child elements of the button
        const viewAllBtn = e.target.closest('#viewAllPublishedBtn');
        if (viewAllBtn) {
            // Navigate to the 'uploads' view
            navigateToView('uploads');

            // Find and programmatically click the 'Production' tab in the uploads view
            const productionTab = document.getElementById('uploads-production-tab');
            if (productionTab) {
                // This triggers the existing tab switching logic in uploads.js
                productionTab.click(); 
            }
        }
    });
    
    // Attach Top-Level Event Listeners for file selection
    if (selectHdpcFileBtn) {
        selectHdpcFileBtn.addEventListener('click', async () => {
            if (window.electronAPI?.openFile) {
                const filePath = await window.electronAPI.openFile({
                    title: "Open Heritage Data Processor Project",
                    filters: [{ name: 'HDPC Packages', extensions: ['hdpc', 'db', 'sqlite'] }]
                });
                await handleHdpcFileSelection(filePath);
            } else {
                hdpcFileUpload.click();
            }
        });
    }

    if (hdpcFileUpload) {
        hdpcFileUpload.addEventListener('change', async (event) => {
            const file = event.target.files[0];
            if (!file) {
                if (fileNameDisplay) fileNameDisplay.textContent = 'No file chosen';
                resetDisplay();
                return;
            }
            if (fileNameDisplay) fileNameDisplay.textContent = file.name;
            if (loader) loader.style.display = 'block';
            resetDisplay();
            try {
                const SQL = await initSqlJs({ 
                    locateFile: filename => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/${filename}` 
                });
                const fileBuffer = await file.arrayBuffer();
                const db = new SQL.Database(new Uint8Array(fileBuffer)); 
                await fetchAndDisplayAllDataFromDB(db); 
                showToast(`Successfully opened "${file.name}" (sql.js mode)`, 'success');
            } catch (error) {
                console.error("[Renderer] Error processing .hdpc with sql.js:", error);
                showToast(`Error: ${error.message}.`, 'error');
            } finally {
                if (loader) loader.style.display = 'none';
            }
            navigateToView('dashboard');
            hdpcFileUpload.value = ''; 
        });
    }

    // Navigate to the initial view
    navigateToViewInternal('dashboard', true);

    // --- Startup Info Modal Logic (Disclaimer & Changelog) ---
    const dialogOverlay = document.getElementById('changelogDialog');
    const disclaimerContentEl = document.getElementById('disclaimer-content');
    const changelogContentEl = document.getElementById('changelog-content');
    const closeButton = document.getElementById('closeChangelogBtn');
    const checkbox = document.getElementById('dontShowAgainCheckbox');

    if (dialogOverlay && disclaimerContentEl && changelogContentEl && closeButton && checkbox && window.electronAPI) {
        
        // 1. Listen for startup info from the main process
        window.electronAPI.onShowStartupInfo((data) => {
            // Set the innerHTML for both sections from the payload
            disclaimerContentEl.innerHTML = data.disclaimerHtml || '<p>Could not load disclaimer.</p>';
            changelogContentEl.innerHTML = data.changelogHtml || '<p>Could not load changelog.</p>';
            dialogOverlay.classList.remove('hidden');
        });

        // 2. Define the function to close the dialog
        const closeDialog = () => {
            const showAgain = !checkbox.checked;
            window.electronAPI.setShowStartupDialog(showAgain);
            dialogOverlay.classList.add('hidden');
        };

        // 3. Attach event listeners
        closeButton.addEventListener('click', closeDialog);
        
        dialogOverlay.addEventListener('click', (event) => {
            if (event.target === dialogOverlay) {
                closeDialog();
            }
        });

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && !dialogOverlay.classList.contains('hidden')) {
                closeDialog();
            }
        });
    }
});