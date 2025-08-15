// src/renderer/js/core/api.js

import { setAppDataCache, appDataCache, currentlyLoadedHdpcPath, setProjectContext } from './state.js';
import { showToast, loader, resetDisplay } from './ui.js';
import { displayAllSectionsFromCache } from '../views/dashboard.js';
import { navigateToView } from './navigation.js';
import { addToLog } from '../renderer.js';

// --- Constants ---
export const PYTHON_API_BASE_URL = typeof window.electronAPI !== 'undefined'
                            ? window.electronAPI.getPythonServerUrl()
                            : 'http://localhost:5001';

export const ITEMS_PER_PAGE = 25;

// --- Pagination State (Exported for other modules to use) ---
export let totalFiles = 0;
export let currentFilesData = [];
export let totalApiLogEntries = 0;

// --- Main Data Fetching Function ---
export async function fetchAndDisplayAllDataFromBackend() {
    console.log("[Renderer] Starting fetchAndDisplayAllDataFromBackend...");
    if (loader) loader.style.display = 'block';
    setAppDataCache(null); // Use setter to reset cache

    if (!currentlyLoadedHdpcPath) {
        showToast("Cannot fetch project data: No HDPC project is loaded.", "error");
        console.error("[Renderer] fetchAndDisplayAllDataFromBackend: currentlyLoadedHdpcPath is not set.");
        if (loader) loader.style.display = 'none';
        resetDisplay();
        return;
    }
    console.log(`[DEBUG Renderer] fetchAndDisplayAllDataFromBackend: Using hdpcPath: ${currentlyLoadedHdpcPath}`);

    try {
        const encodedHdpcPath = encodeURIComponent(currentlyLoadedHdpcPath);
        const endpoints = {
            projectInfo: `${PYTHON_API_BASE_URL}/api/project_details_with_modality?hdpcPath=${encodedHdpcPath}`,
            zenodoRecord: `${PYTHON_API_BASE_URL}/api/zenodo_record?hdpcPath=${encodedHdpcPath}`,
            filesInitial: `${PYTHON_API_BASE_URL}/api/files?page=1&limit=${ITEMS_PER_PAGE}&hdpcPath=${encodedHdpcPath}`,
            configuration: `${PYTHON_API_BASE_URL}/api/configuration?hdpcPath=${encodedHdpcPath}`,
            pipelineSteps: `${PYTHON_API_BASE_URL}/api/pipeline_steps?hdpcPath=${encodedHdpcPath}`,
            batches: `${PYTHON_API_BASE_URL}/api/batches?hdpcPath=${encodedHdpcPath}`,
            mappings: `${PYTHON_API_BASE_URL}/api/mappings?hdpcPath=${encodedHdpcPath}`,
            apiLogInitial: `${PYTHON_API_BASE_URL}/api/apilog?page=1&limit=${ITEMS_PER_PAGE}&hdpcPath=${encodedHdpcPath}`,
            credentials: `${PYTHON_API_BASE_URL}/api/credentials?hdpcPath=${encodedHdpcPath}`
        };

        const fetchedResults = {};
        const errors = [];

        for (const key in endpoints) {
            try {
                const response = await fetch(endpoints[key]);
                const responseText = await response.text();
                if (!response.ok) {
                    let errorMsg = `${key}: ${response.statusText} (Status ${response.status})`;
                    try {
                        const errorData = JSON.parse(responseText);
                        errorMsg = errorData.error || (errorData.message || errorMsg);
                    } catch (e) { /* response was not JSON */ }
                    throw new Error(errorMsg);
                }
                fetchedResults[key] = JSON.parse(responseText);
            } catch (err) {
                console.error(`[Renderer] Error fetching or parsing ${key}:`, err);
                errors.push(err.message);
                fetchedResults[key] = null;
            }
        }

        if (errors.length > 0) {
            showToast(`Partial data load. Errors: ${errors.join('; ')}`, "warning", 7000);
        }

        if (fetchedResults.projectInfo && fetchedResults.projectInfo.project_id) {
            setProjectContext(currentlyLoadedHdpcPath, fetchedResults.projectInfo.project_id);
        }

        let processedMappings = [];
        if (fetchedResults.mappings) {
            if (Array.isArray(fetchedResults.mappings)) {
                processedMappings = fetchedResults.mappings;
            } else if (typeof fetchedResults.mappings === 'object' && fetchedResults.mappings.error) {
                showToast(`Error fetching mappings: ${fetchedResults.mappings.error}`, "error");
            } else {
                console.warn("Unexpected format for mappings:", fetchedResults.mappings);
            }
        }

        const newCache = {
            projectInfo: fetchedResults.projectInfo ? [fetchedResults.projectInfo] : [],
            zenodoRecord: fetchedResults.zenodoRecord ? [fetchedResults.zenodoRecord] : [],
            filesData: fetchedResults.filesInitial || { items: [], totalItems: 0 },
            configuration: fetchedResults.configuration || [],
            pipelineSteps: fetchedResults.pipelineSteps || [],
            batches: fetchedResults.batches || [],
            mappings: processedMappings,
            apiLogData: fetchedResults.apiLogInitial || { items: [], totalItems: 0 },
            credentials: fetchedResults.credentials || []
        };
        setAppDataCache(newCache); // Use setter

        // Update exported state variables
        totalFiles = newCache.filesData.totalItems || 0;
        currentFilesData = newCache.filesData.items || [];
        totalApiLogEntries = newCache.apiLogData.totalItems || 0;

        displayAllSectionsFromCache();
        showToast("Data loaded from backend.", "success");

        if (window.pipelineConstructor) {
            window.pipelineConstructor.updateInitialStepStatus();
        }

    } catch (error) {
        console.error("[Renderer] Overall error in fetchAndDisplayAllDataFromBackend:", error);
        showToast(`Error loading data from backend: ${error.message}`, "error", 7000);
        setAppDataCache(getMockHdpcData()); // Use setter for fallback
        displayAllSectionsFromCache();
    } finally {
        if (loader) loader.style.display = 'none';
    }
}

// --- File Management Functions ---
export async function backendAddSourceFiles(absoluteFilePaths) {
    if (!absoluteFilePaths || absoluteFilePaths.length === 0) {
        showToast("No files selected to add.", "info");
        return;
    }
    if (!appDataCache || !appDataCache.projectInfo || appDataCache.projectInfo.length === 0) {
        showToast("Please load a HDPC project before adding files.", "error");
        return;
    }

    if (loader) loader.style.display = 'block';
    addToLog('Add Files', `Attempting to add ${absoluteFilePaths.length} files to the project.`);

    try {
        const response = await fetch(`${PYTHON_API_BASE_URL}/api/project/source_files/add`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ absolute_file_paths: absoluteFilePaths })
        });

        const result = await response.json();
        if (!response.ok) {
            const errorMsgFromServer = result.error || (result.errors && result.errors.join(", ")) || `Server error: ${response.status}`;
            throw new Error(errorMsgFromServer);
        }

        let message = `Added: ${result.added_count || 0} file(s).`;
        if (result.skipped_existing_path > 0) message += ` Skipped ${result.skipped_existing_path} (already in project).`;
        if (result.skipped_duplicate_hash > 0) message += ` Skipped ${result.skipped_duplicate_hash} (duplicate content).`;
        if (result.errors_count > 0) message += ` Errors on ${result.errors_count} file(s).`;

        showToast(message, result.added_count > 0 ? 'success' : 'info', 7000);
        addToLog('Add Files', `Successfully processed add files request. Server response: ${message}`);

        await fetchAndDisplayAllDataFromBackend();
        if (document.getElementById('view-files').classList.contains('active')) {
            navigateToView('files');
        }

    } catch (error) {
        console.error("Error adding source files:", error);
        showToast(`Error adding files: ${error.message}`, "error", 7000);
        addToLog('Add Files', `Critical error during add files operation: ${error.message}`);
    } finally {
        if (loader) loader.style.display = 'none';
    }
}


// --- Fallback Data ---
function getMockHdpcData() {
    return {
        projectInfo: [{ project_name: "Mock Project", description: "This is mock data shown because the uploaded file could not be read or was invalid.", hdpc_schema_version: "N/A" }],
        zenodoRecord: [{ record_title: "A Mock Study", zenodo_doi: "10.5072/zenodo.mock", record_status: "draft", version: "1", record_metadata_json: JSON.stringify({ description: "Mock Zenodo record description.", creators: [{name: "Dr. Mockup"}], keywords: ["mock", "fallback"]}) }],
        filesData: { items: Array.from({length: 55}, (_, i) => ({ filename: `mock_file_${i+1}.csv`, relative_path: "data/", size_bytes: 1000 + (i*100), mime_type: "text/csv", file_type: "dataset", status: "processed" })), totalItems: 55 },
        configuration: [{ config_key: "mock_setting", config_value: "true" }],
        pipelineSteps: [{ modality: "images", component_name: "blur_faces", component_order: 1, is_active: 1, parameters: "{'level': 5}" }],
        batches: [{ batch_name: "Initial Upload Batch", batch_description: "First set of data.", status: "completed", created_timestamp: new Date().toISOString() }],
        mappings: [{ mapping_name: "Complex Data Mapping", file_path: "mappings/complex_map.xlsx", file_format: "excel", column_definitions: JSON.stringify({ "filename": "file name", "title": {"type": "column", "value": "header"} }) }],
        apiLogData: { items: [], totalItems: 70 },
        credentials: [{ credential_name: "Zenodo Sandbox Key", credential_type: "zenodo_api_key", is_sandbox: 1 }],
        operabilityTests: [
            { id: "test_sandbox_api", name: "Zenodo Sandbox API Reachable", status: "notrun", message: "", mockResult: {status: "success", message: "Sandbox API OK (mocked)."} },
            { id: "test_production_api", name: "Zenodo Production API Reachable", status: "notrun", message: "", mockResult: {status: "success", message: "Production API OK (mocked)."} },
            { id: "test_db_connection", name: "Database Connection (Current HDPC)", status: "notrun", message: "Requires a HDPC file to be loaded.", mockResult: {status: "failure", message: "Mock: No HDPC loaded to test."} },
            { id: "test_config_files", name: "Default Configuration Files Check", status: "notrun", message: "", mockResult: {status: "success", message: "Config files appear OK (mocked)."} }
        ]
    };
}

export function resetApiState() {
    totalFiles = 0;
    currentFilesData = [];
    totalApiLogEntries = 0;
}