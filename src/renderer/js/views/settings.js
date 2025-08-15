// src/renderer/js/views/settings.js

import { showToast } from '../core/ui.js';
import { mainAppConfigCache, mainAppConfigDirAbsPath, setMainAppConfig } from '../core/state.js';
import { PYTHON_API_BASE_URL } from '../core/api.js';
import { addToLog } from '../renderer.js';

// --- DOM Elements ---
const settingsBtn = document.getElementById('settingsBtn');
const settingsModal = document.getElementById('settingsModal');
const closeSettingsModalBtn = document.getElementById('closeSettingsModalBtn');
const settingsFormContainer = document.getElementById('settingsFormContainer');
const cancelSettingsBtn = document.getElementById('cancelSettingsBtn');
const saveSettingsBtn = document.getElementById('saveSettingsBtn');

// --- Constants ---
const settingsMap = {
    "Core Settings": {
        "core.use_sandbox": { type: "boolean", label: "Use Zenodo Sandbox" },
        "core.use_env_file": { type: "boolean", label: "Load Keys from .env File" },
    },
    "Paths": {
        "paths.data_in": { type: "text", label: "Input Data Directory", inputType: "directory" },
        "paths.data_out": { type: "text", label: "Output Data Directory", inputType: "directory" },
        "paths.env_file": {
            type: "text",
            label: "Environment File Path (.env)",
            inputType: "file",
            fileFilters: [
                { name: 'Environment Files', extensions: ['env'] },
                { name: 'All Files', extensions: ['*'] }
            ],
            isOpenable: true
        },
        "paths.models": { type: "text", label: "Models Directory", inputType: "directory" },
        "paths.db_sqlite": {
            type: "text",
            label: "SQLite Database Path",
            inputType: "file",
            fileFilters: [
                { name: 'Database Files', extensions: ['db', 'sqlite', 'sqlite3'] },
                { name: 'All Files', extensions: ['*'] }
            ]
        },
        "paths.prompts_file": {
            type: "text",
            label: "Prompts YAML File",
            inputType: "file",
            isOpenable: true,
            fileFilters: [
                { name: 'YAML Files', extensions: ['yaml', 'yml'] },
                { name: 'All Files', extensions: ['*'] }
            ]
        },
        "paths.geocache_file": {
            type: "text",
            label: "GeoCache JSON File",
            inputType: "file",
            fileFilters: [
                { name: 'JSON Files', extensions: ['json'] },
                { name: 'All Files', extensions: ['*'] }
            ],
            isOpenable: true
        },
        "paths.pipeline_components_file": {
            type: "text",
            label: "Pipeline Components YAML",
            inputType: "file",
            isOpenable: true,
            fileFilters: [
                { name: 'YAML Files', extensions: ['yaml', 'yml'] },
                { name: 'All Files', extensions: ['*'] }
            ]
        }
    },
    "API URLs": {
        "urls.base_url": { type: "text", label: "Zenodo Production URL" },
        "urls.sandbox_url": { type: "text", label: "Zenodo Sandbox URL" },
        "urls.geonames_url": { type: "text", label: "GeoNames API URL"},
        "urls.nominatim_url": { type: "text", label: "Nominatim Search URL"},
        "urls.nominatim_reverse_url": { type: "text", label: "Nominatim Reverse URL"},
        "urls.overpass_url": { type: "text", label: "Overpass API URL"}
    },
    "API Keys & Agents": {
        "geonames.username": { type: "text", label: "GeoNames Username" },
        "nominatim.user_agent": { type: "text", label: "Nominatim User-Agent" },
    },
    "Rate Limits": {
        "rates.per_minute": { type: "number", label: "Requests per Minute", min:1, max: 100, step:1 },
        "rates.per_hour": { type: "number", label: "Requests per Hour", min:1, max: 5000, step:1 },
    },
    "Geolocation": {
        "geolocation.similarity_threshold": { type: "number", label: "Similarity Threshold", min:0, max:1, step: "0.01" },
        "geolocation.nominatim_truncate_words": { type: "number", label: "Nominatim Truncate Words", min:1, step: "1" },
        "geolocation.enhanced_similarity": { type: "boolean", label: "Enhanced Similarity" },
        "geolocation.initial_bbox_query": { type: "boolean", label: "Initial BBox Query (OSM)" },
        "geolocation.identify_by_llm": { type: "boolean", label: "Identify by LLM" },
        "geolocation.verbose_llm_calls": { type: "boolean", label: "Verbose LLM Calls" }
    },
    "LLM Prompts": {
        "llm_prompts.geo_extraction_id": { type: "select", label: "Geo Extraction ID", dataSource: "prompt_ids", targetFor: "llm_prompts.geo_extraction_key" },
        "llm_prompts.geo_extraction_key": { type: "select", label: "Geo Extraction Key", dataSource: "prompt_sub_keys", dependsOn: "llm_prompts.geo_extraction_id" },
        "llm_prompts.entity_matching_id": { type: "select", label: "Entity Matching ID", dataSource: "prompt_ids", targetFor: "llm_prompts.entity_matching_key" },
        "llm_prompts.entity_matching_key": { type: "select", label: "Entity Matching Key", dataSource: "prompt_sub_keys", dependsOn: "llm_prompts.entity_matching_id" }
    },
    "Ollama Configuration": {
        "ollama.port": { type: "number", label: "Ollama Port", min:1, step: "1" },
        "ollama.model_minor": { type: "text", label: "Minor Model (e.g., gemma2:2b)" },
        "ollama.model_minor_timeout": { type: "number", label: "Minor Model Timeout (s)", min:1, step: "1" },
        "ollama.model_medium": { type: "text", label: "Medium Model (e.g., llama3:8b)" },
        "ollama.model_medium_timeout": { type: "number", label: "Medium Model Timeout (s)", min:1, step: "1" },
        "ollama.model_major": { type: "text", label: "Major Model (e.g., qwen2:72b)" },
        "ollama.model_major_time": { type: "number", label: "Major Model Timeout (s)", min:1, step: "1" }
    }
};

// --- Helper Functions ---
function _getNestedConfigValue(configObject, keyPath) {
    const keys = keyPath.split('.');
    let value = configObject;
    for (const k of keys) {
        if (value && typeof value === 'object' && k in value) {
            value = value[k];
        } else {
            return undefined;
        }
    }
    return value;
}

function _setNestedConfigValue(configObject, keyPath, value) {
    const keys = keyPath.split('.');
    let tempObject = configObject;
    for (let i = 0; i < keys.length - 1; i++) {
        if (!tempObject[keys[i]] || typeof tempObject[keys[i]] !== 'object') {
            tempObject[keys[i]] = {};
        }
        tempObject = tempObject[keys[i]];
    }
    tempObject[keys[keys.length - 1]] = value;
}

async function populateSelectWithOptions(selectElement, optionsArray, currentValue) {
    selectElement.innerHTML = '';
    if (!optionsArray || optionsArray.length === 0) {
        selectElement.innerHTML = '<option value="">No options available</option>';
        return;
    }
    optionsArray.forEach(optionValue => {
        const option = document.createElement('option');
        option.value = optionValue;
        option.textContent = optionValue;
        if (optionValue === currentValue) {
            option.selected = true;
        }
        selectElement.appendChild(option);
    });
}

async function populatePromptSubKeyDropdown(idKey, keyKey, initialRender = false) {
    const idSelectElement = settingsFormContainer.querySelector(`[data-key="${idKey}"]`);
    const keySelectElement = settingsFormContainer.querySelector(`[data-key="${keyKey}"]`);
    if (!idSelectElement || !keySelectElement) return;

    const selectedId = idSelectElement.value;
    const currentKeyValue = _getNestedConfigValue(mainAppConfigCache, keyKey);

    if (!selectedId) {
        populateSelectWithOptions(keySelectElement, ["Select an ID first"], "");
        if (!initialRender) _setNestedConfigValue(mainAppConfigCache, keyKey, "");
        return;
    }

    try {
        const response = await fetch(`${PYTHON_API_BASE_URL}/api/config/get_prompt_keys?prompt_id=${selectedId}`);
        if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.error || `Failed to fetch sub-keys for ${selectedId}`);
        }
        const subKeys = await response.json();
        populateSelectWithOptions(keySelectElement, subKeys, currentKeyValue);

        if (!initialRender && !subKeys.includes(currentKeyValue)) {
            _setNestedConfigValue(mainAppConfigCache, keyKey, subKeys.length > 0 ? subKeys[0] : "");
            if (keySelectElement.options.length > 0) keySelectElement.value = keySelectElement.options[0].value;
        } else if (initialRender && subKeys.includes(currentKeyValue)) {
            keySelectElement.value = currentKeyValue;
        }
    } catch (error) {
        console.error(`Error populating sub-key dropdown for ${keyKey}:`, error);
        populateSelectWithOptions(keySelectElement, [`Error: ${error.message}`], "");
        if (!initialRender) _setNestedConfigValue(mainAppConfigCache, keyKey, "");
    }
}

// --- UI Rendering ---
function createSettingInput(key, value, notes) {
    const inputWrapper = document.createElement('div');
    inputWrapper.className = 'input-wrapper flex items-center space-x-2';
    let inputElement;

    if (notes.type === 'select') {
        inputElement = document.createElement('select');
        inputElement.dataset.key = key;
        inputElement.className = 'flex-grow p-2 border rounded bg-white';
        if (notes.dataSource) {
            inputElement.dataset.source = notes.dataSource;
        }
        if (notes.dataSource === 'prompt_ids') {
            populateSelectWithOptions(inputElement, ["Loading..."], value);
        } else if (notes.dataSource === 'prompt_sub_keys') {
            populateSelectWithOptions(inputElement, ["Select an ID first"], value);
        }
        inputElement.addEventListener('change', (event) => {
            _setNestedConfigValue(mainAppConfigCache, key, event.target.value);
            if (notes.targetFor) {
                populatePromptSubKeyDropdown(key, notes.targetFor);
            }
        });
    } else {
        switch (notes.type) {
            case 'boolean':
                inputElement = document.createElement('label');
                inputElement.className = 'switch';
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.checked = !!value;
                checkbox.dataset.key = key;
                inputElement.appendChild(checkbox);
                const slider = document.createElement('span');
                slider.className = 'slider';
                inputElement.appendChild(slider);
                break;
            default: // Caters to 'text', 'number', etc.
                inputElement = document.createElement('input');
                inputElement.type = notes.type || 'text';
                inputElement.value = value || '';
                inputElement.dataset.key = key;
                inputElement.className = 'flex-grow p-2 border rounded';
                if (notes.max !== undefined) inputElement.max = notes.max;
                if (notes.min !== undefined) inputElement.min = notes.min;
                if (notes.step !== undefined) inputElement.step = notes.step;
                break;
        }
    }
    inputWrapper.appendChild(inputElement);

    if (notes.inputType === 'file' || notes.inputType === 'directory') {
        const browseBtn = document.createElement('button');
        browseBtn.textContent = 'Browse...';
        browseBtn.className = 'btn-secondary text-sm py-1 px-2';
        browseBtn.type = 'button';
        browseBtn.addEventListener('click', async () => {
            let selectedPath;
            if (notes.inputType === 'file') {
                selectedPath = await window.electronAPI.openFile({
                    properties: ['openFile'],
                    filters: notes.fileFilters || [{ name: 'All Files', extensions: ['*'] }]
                });
            } else {
                selectedPath = await window.electronAPI.openDirectory();
            }
            if (selectedPath) {
                inputElement.value = selectedPath;
            }
        });
        inputWrapper.appendChild(browseBtn);
    }

    if (notes.isOpenable && notes.inputType === 'file') {
        const openBtn = document.createElement('button');
        openBtn.textContent = 'Open';
        openBtn.className = 'btn-primary text-sm py-1 px-2';
        openBtn.type = 'button';
        openBtn.addEventListener('click', async () => {
            const filePathValue = inputElement.value;
            if (filePathValue) {
                const result = await window.electronAPI.resolveAndOpenPath({
                    basePath: mainAppConfigDirAbsPath,
                    relativePath: filePathValue
                });
                if (!result.success) {
                    showToast(`Error opening file: ${result.error}`, 'error');
                }
            }
        });
        inputWrapper.appendChild(openBtn);
    }
    return inputWrapper;
}

async function populateDynamicSelectsInSettings(config) {
    if (!settingsFormContainer) return;
    try {
        const promptIdElements = settingsFormContainer.querySelectorAll('select[data-source="prompt_ids"]');
        if (promptIdElements.length === 0) return;

        const idResponse = await fetch(`${PYTHON_API_BASE_URL}/api/config/get_prompt_keys`);
        if (!idResponse.ok) throw new Error('Failed to fetch prompt IDs.');
        const promptIdsFromServer = await idResponse.json();

        for (const idSelectElement of promptIdElements) {
            const configKey = idSelectElement.dataset.key;
            const currentValue = _getNestedConfigValue(config, configKey);
            populateSelectWithOptions(idSelectElement, promptIdsFromServer, currentValue);

            let notes = null;
            for (const sectionName in settingsMap) {
                if (settingsMap[sectionName]?.[configKey]) {
                    notes = settingsMap[sectionName][configKey];
                    break;
                }
            }
            if (notes?.targetFor) {
                await populatePromptSubKeyDropdown(configKey, notes.targetFor, true);
            }
        }
    } catch (error) {
        console.error("Error populating dynamic selects:", error);
        showToast(`Error loading prompt IDs: ${error.message}`, 'error');
    }
}

async function renderSettingsForm(config) {
    if (!settingsFormContainer) return;
    settingsFormContainer.innerHTML = '';

    const createSection = (title) => {
        const section = document.createElement('div');
        section.className = 'settings-section mb-6';
        section.innerHTML = `<h4 class="text-lg font-semibold text-gray-800 mb-4 border-b pb-2">${title}</h4>`;
        return section;
    };

    const createSettingItemDOM = (key, value, notes) => {
        const item = document.createElement('div');
        item.className = 'setting-item mb-3';
        const label = document.createElement('label');
        label.className = 'block text-sm font-medium text-gray-700 mb-1';
        label.textContent = notes.label || key;
        label.title = key;
        item.appendChild(label);
        item.appendChild(createSettingInput(key, value, notes));
        if (notes.description) {
            item.innerHTML += `<p class="text-xs text-gray-500 mt-1">${notes.description}</p>`;
        }
        return item;
    };

    for (const [sectionTitle, settings] of Object.entries(settingsMap)) {
        const sectionEl = createSection(sectionTitle);
        for (const [key, notes] of Object.entries(settings)) {
            const value = _getNestedConfigValue(config, key);
            sectionEl.appendChild(createSettingItemDOM(key, value, notes));
        }
        settingsFormContainer.appendChild(sectionEl);
    }

    await populateDynamicSelectsInSettings(config);
}

// --- Main Functions ---
async function openSettingsModal() {
    try {
        addToLog('Settings', 'Attempting to load main application configuration for editing.');
        const response = await fetch(`${PYTHON_API_BASE_URL}/api/config/get`);
        if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.error || 'Failed to load main configuration.');
        }
        const responseData = await response.json();
        setMainAppConfig(responseData.configData || {}, responseData.configDirAbsPath || '');

        await renderSettingsForm(mainAppConfigCache);
        settingsModal.classList.remove('hidden');
    } catch (error) {
        console.error("Error opening settings:", error);
        showToast(`Error loading settings: ${error.message}`, 'error');
    }
}

async function saveSettings() {
    const updatedConfig = JSON.parse(JSON.stringify(mainAppConfigCache));
    settingsFormContainer.querySelectorAll('[data-key]').forEach(input => {
        const keyPath = input.dataset.key;
        let value = input.type === 'checkbox' ? input.checked : (input.type === 'number' ? Number(input.value) : input.value);
        _setNestedConfigValue(updatedConfig, keyPath, value);
    });

    try {
        const response = await fetch(`${PYTHON_API_BASE_URL}/api/config/save`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updatedConfig)
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Failed to save configuration.');

        showToast('Configuration saved successfully!', 'success');
        settingsModal.classList.add('hidden');
        setMainAppConfig(updatedConfig, mainAppConfigDirAbsPath); // Update state
    } catch (error) {
        console.error("Error saving settings:", error);
        showToast(`Error saving settings: ${error.message}`, 'error');
    }
}

// --- Initialization ---
export function initSettings() {
    if (settingsBtn) settingsBtn.addEventListener('click', openSettingsModal);
    if (closeSettingsModalBtn) closeSettingsModalBtn.addEventListener('click', () => settingsModal.classList.add('hidden'));
    if (cancelSettingsBtn) cancelSettingsBtn.addEventListener('click', () => settingsModal.classList.add('hidden'));
    if (saveSettingsBtn) saveSettingsBtn.addEventListener('click', saveSettings);
}