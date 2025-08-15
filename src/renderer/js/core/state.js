// src/renderer/js/core/state.js
import { PYTHON_API_BASE_URL } from '../core/api.js';
import { showToast } from '../core/ui.js';

// --- Global State ---
export let mainAppConfigCache = {};
export let mainAppConfigDirAbsPath = '';
export let currentlyLoadedHdpcPath = null;
export let currentProjectId = null;
export let zenodoMappingSchema = null;
export let appDataCache = null;
export let availablePipelines = [];

// --- State Setters ---
export function setMainAppConfig(config, path) {
    mainAppConfigCache = config;
    mainAppConfigDirAbsPath = path;
}

export function setProjectContext(path, id) {
    currentlyLoadedHdpcPath = path;
    currentProjectId = id;
}

export function setAppDataCache(cache) {
    appDataCache = cache;
}

export function setZenodoSchema(schema) {
    zenodoMappingSchema = schema;
    window.zenodoMappingSchema = schema;
}

export function clearZenodoSchemaCache() {
    zenodoMappingSchema = null;
    window.zenodoMappingSchema = null;
    console.log("Zenodo mapping schema cache has been cleared.");
}

export function setAvailablePipelines(pipelines) {
    availablePipelines = pipelines;
}

/**
 * Ensures the Zenodo mapping schema is loaded.
 * Fetches from the backend on the first call and caches the result.
 * @returns {Promise<object>} The Zenodo mapping schema.
 * @throws {Error} If the schema cannot be fetched or is invalid.
 */
export async function ensureZenodoSchema() {
    if (zenodoMappingSchema) {
        return zenodoMappingSchema; // Return cached version
    }

    try {
        console.log("Fetching Zenodo mapping schema from backend...");
        const response = await fetch(`${PYTHON_API_BASE_URL}/api/metadata/mapping_schema_details`);
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `Failed to fetch mapping schema: ${response.statusText}`);
        }
        
        const schema = await response.json();
        if (!schema?.standard_fields || !schema?.complex_fields) {
            throw new Error("Fetched mapping schema is invalid or incomplete.");
        }

        setZenodoSchema(schema); // Cache the schema
        console.log("Zenodo mapping schema loaded and cached.");
        return schema;
    } catch (error) {
        showToast(`Critical Error: ${error.message}`, 'error');
        console.error("Failed to ensure Zenodo schema:", error);
        throw error; // Re-throw the error so calling functions can handle it
    }
}

export function resetProjectState() {
    currentlyLoadedHdpcPath = null;
    currentProjectId = null;
    appDataCache = null;
    zenodoMappingSchema = null;
}

// --- State Checkers ---
export function isProjectLoaded() {
    return !!currentlyLoadedHdpcPath;
}