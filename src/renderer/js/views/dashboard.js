// src/renderer/js/views/dashboard.js

import { appDataCache, currentlyLoadedHdpcPath } from '../core/state.js';
import { loader, resetDisplay, showToast } from '../core/ui.js';
import { loadOperabilityTests } from './operability.js';
import { PYTHON_API_BASE_URL, ITEMS_PER_PAGE, totalFiles, currentFilesData, totalApiLogEntries } from '../core/api.js';

// --- DOM Elements ---
const hdpcContentsDisplay = document.getElementById('hdpcContentsDisplay');
const noFileLoaded = document.getElementById('noFileLoaded');
const filesList = document.getElementById('metadataFiles');
const fileCountEl = document.getElementById('fileCount');
const noFilesMsg = document.getElementById('noFilesMessage');
const filesPageInfo = document.getElementById('filesPageInfo');
const prevFilesPageBtn = document.getElementById('prevFilesPage');
const nextFilesPageBtn = document.getElementById('nextFilesPage');
const fileSearchInput = document.getElementById('fileSearchInput');
const apiLogListEl = document.getElementById('apiLogList');
const apiLogCountEl = document.getElementById('apiLogCount');
const noApiLogMsg = document.getElementById('noApiLogMessage');
const apiLogPageInfo = document.getElementById('apiLogPageInfo');
const prevApiLogPageBtn = document.getElementById('prevApiLogPage');
const nextApiLogPageBtn = document.getElementById('nextApiLogPage');
const editProjectDescriptionBtn = document.getElementById('editProjectDescriptionBtn');
const editDescriptionModal = document.getElementById('editDescriptionModal');
const closeEditDescriptionModalBtn = document.getElementById('closeEditDescriptionModalBtn');
const cancelEditDescriptionBtn = document.getElementById('cancelEditDescriptionBtn');
const saveDescriptionBtn = document.getElementById('saveDescriptionBtn');
const projectDescriptionTextarea = document.getElementById('projectDescriptionTextarea');
const statsTotalFiles = document.getElementById('statsTotalFiles');
const statsFilesWithMetadata = document.getElementById('statsFilesWithMetadata');
const statsSandboxRecords = document.getElementById('statsSandboxRecords');
const statsProductionRecords = document.getElementById('statsProductionRecords');
const editProjectTitleBtn = document.getElementById('editProjectTitleBtn');
const editTitleModal = document.getElementById('editTitleModal');
const closeEditTitleModalBtn = document.getElementById('closeEditTitleModalBtn');
const cancelEditTitleBtn = document.getElementById('cancelEditTitleBtn');
const saveTitleBtn = document.getElementById('saveTitleBtn');
const projectTitleInput = document.getElementById('projectTitleInput');
const latestPublishedList = document.getElementById('latestPublishedList');

// --- State ---
let filesCurrentPage = 1;
let apiLogCurrentPage = 1;

// --- Main Display Function ---
export function displayAllSectionsFromCache() {
    if (!appDataCache) {
        console.warn("[Renderer] No data in appDataCache. Using mock data for display.");
        appDataCache = getMockHdpcData();
        // Initialize counts from mock if necessary for subsequent pagination calls
        totalFiles = appDataCache.sourceFiles.length;
        currentFilesData = appDataCache.sourceFiles; // For client-side pagination of mock
        totalApiLogEntries = appDataCache.apiLog.length;
    }
    console.log("[Renderer] displayAllSectionsFromCache is rendering with data:", appDataCache);

    const data = appDataCache;

    // Project Overview
    const project = (data.projectInfo && data.projectInfo[0]) ? data.projectInfo[0] : {};
    const overviewProjectNameEl = document.getElementById('overviewProjectName');
    if (overviewProjectNameEl) overviewProjectNameEl.textContent = project.project_name || 'N/A'; else console.error("Missing overviewProjectNameEl");

    const overviewSchemaVersionEl = document.getElementById('overviewSchemaVersion');
    if (overviewSchemaVersionEl) overviewSchemaVersionEl.textContent = project.hdpc_schema_version || 'N/A';
    const overviewDescriptionEl = document.getElementById('overviewDescription');
    if (overviewDescriptionEl) overviewDescriptionEl.textContent = project.description || 'No description provided.';
    /* TODO: Add more checks */


    // Zenodo Record
    const recordCard = document.getElementById('zenodoRecordCard');
    const noZenodoMsg = document.getElementById('noZenodoRecordMessage');
    if (data.zenodoRecord && data.zenodoRecord.length > 0 && Object.keys(data.zenodoRecord[0]).length > 0) {
        const record = data.zenodoRecord[0];
        let metadata = {};
        try { metadata = record.record_metadata_json ? JSON.parse(record.record_metadata_json) : {}; } catch(e) { metadata = {}; }
        
        const el_title = document.getElementById('metadataTitle'); if(el_title) el_title.textContent = record.record_title || metadata.title || 'N/A';
        const el_doi = document.getElementById('metadataDoi'); if(el_doi) el_doi.textContent = record.zenodo_doi || 'Not yet assigned';
        const el_status = document.getElementById('metadataStatus'); if(el_status) el_status.textContent = record.record_status || 'N/A';
        const el_version = document.getElementById('metadataVersion'); if(el_version) el_version.textContent = record.version || 'N/A';
        const el_desc = document.getElementById('metadataDescription'); if(el_desc) el_desc.textContent = metadata.description || 'No description provided.';
        
        const creatorsEl = document.getElementById('metadataCreators'); 
        if(creatorsEl) { /* ... TODO ... */ }
        const keywordsEl = document.getElementById('metadataKeywords');
        if(keywordsEl) { /* ... TOO ... */ }

        if(recordCard) recordCard.classList.remove('hidden'); 
        if(noZenodoMsg) noZenodoMsg.classList.add('hidden');
    } else { 
        const el_title_clear = document.getElementById('metadataTitle'); if(el_title_clear) el_title_clear.textContent = 'N/A'; 
        if(noZenodoMsg) noZenodoMsg.classList.remove('hidden'); 
    }
    
    // Files, API Log are rendered by their pagination functions called from navigateToView
    // Ensure their data (currentFilesData, totalFiles, totalApiLogEntries) is set correctly before navigateToView calls them.
    // displayAllSectionsFromCache itself will call the initial page render for these.
    renderPaginatedFiles(1, fileSearchInput ? fileSearchInput.value : ''); 
    renderPaginatedApiLog(1); 

    // Pipeline
    const pipelines = data.pipelineSteps || [];
    const pipelineList = document.getElementById('pipelineSteps');
    if(pipelineList) pipelineList.innerHTML = pipelines.length > 0 ? pipelines.map(p => `<div class="p-2 bg-gray-50 rounded-md border border-gray-200 flex items-center gap-4"><span class="font-mono text-xs font-bold">${p.component_order}.</span><div><p class="font-medium text-sm text-gray-800">${p.component_name}</p><p class="text-xs text-gray-500">Modality: ${p.modality} ${p.parameters ? `- Params: ${p.parameters.substring(0,30)}...`: ''}</p></div><span class="ml-auto badge ${p.is_active ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}">${p.is_active ? 'Active' : 'Inactive'}</span></div>`).join('') : '';
    const noPipelineMsg = document.getElementById('noPipelineMessage'); if(noPipelineMsg) noPipelineMsg.style.display = pipelines.length === 0 ? 'block' : 'none';
    const pipelineCardEl = document.getElementById('pipelineCard'); if(pipelineCardEl) pipelineCardEl.style.display = pipelines.length > 0 ? 'block' : 'none';

    // Config
    const config = data.configuration || [];
    const configPre = document.getElementById('hdpcConfig');
    if(configPre) { /* ... TODO ... */ }
    const noConfigMsg = document.getElementById('noConfigMessage'); if(noConfigMsg) noConfigMsg.style.display = config.length === 0 ? 'block' : 'none';
    const configCardEl = document.getElementById('configCard'); if(configCardEl) configCardEl.style.display = config.length > 0 ? 'block' : 'none';
    
    // Batches
    const batches = data.batches || [];
    const batchCountEl = document.getElementById('batchCount'); if(batchCountEl) batchCountEl.textContent = batches.length;
    const batchesListEl = document.getElementById('batchesList'); 
    if(batchesListEl) { /* ... TODO ... */ }
    const noBatchesMsg = document.getElementById('noBatchesMessage'); if(noBatchesMsg) noBatchesMsg.style.display = batches.length === 0 ? 'block' : 'none';
    
    // Mappings
    const mappings = data.mappings || [];
    const mappingCountEl = document.getElementById('mappingCount'); if(mappingCountEl) mappingCountEl.textContent = mappings.length;
    const mappingsListEl = document.getElementById('mappingsList');
    if(mappingsListEl) {  /* ... TODO: ensure renderDefinitionObject is called ... */
        mappingsListEl.innerHTML = mappings.length > 0 ? mappings.map(m => {
            let columnDefsHtml = '<span class="text-gray-500">No definitions.</span>';
            try {
                const defs = JSON.parse(m.column_definitions || '{}');
                if (Object.keys(defs).length > 0) {
                    columnDefsHtml = `<ul class="mapping-def-list">${renderDefinitionObject(defs)}</ul>`;
                }
            } catch (e) { columnDefsHtml = `<span class="text-red-500">Error parsing definitions.</span>`; }
            return `<div class="p-3 bg-gray-50 rounded-md border border-gray-200"><p class="font-medium text-sm text-gray-700">${m.mapping_name} <span class="text-xs text-gray-400">(${m.file_format})</span></p><p class="text-xs text-gray-500">Path: ${m.file_path}</p><details class="text-xs mt-1"><summary class="cursor-pointer text-blue-600 hover:text-blue-800 font-medium">Column Definitions</summary><div class="bg-white p-2 mt-1 rounded border">${columnDefsHtml}</div></details></div>`;
        }).join('') : '';
    }
    const noMappingsMsg = document.getElementById('noMappingsMessage'); if(noMappingsMsg) noMappingsMsg.style.display = mappings.length === 0 ? 'block' : 'none';
    
    // Credentials
    const credentials = data.credentials || [];
    const credCountEl = document.getElementById('credentialCount'); if(credCountEl) credCountEl.textContent = credentials.length;
    const credentialsListEl = document.getElementById('credentialsList');
    if(credentialsListEl) { /* ... TODO ... */ }
    const noCredMsg = document.getElementById('noCredentialsMessage'); if(noCredMsg) noCredMsg.style.display = credentials.length === 0 ? 'block' : 'none';

    if(hdpcContentsDisplay) hdpcContentsDisplay.classList.remove('hidden');
    if(noFileLoaded) noFileLoaded.classList.add('hidden');
    
    updateDashboardMappingStatus();
    
    fetchAndDisplayDashboardStats();
    fetchAndDisplayPublishedRecords();
    loadOperabilityTests(); 
    console.log("[Renderer] displayAllSectionsFromCache finished UI updates.");
}

// --- Helper for Display ---
function renderDefinitionObject(obj) {
    if (!obj || typeof obj !== 'object' || Object.keys(obj).length === 0) {
        return '';
    }
    let html = '';
    for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
            const value = obj[key];
            const formattedValue = renderDefinitionValue(value);
            html += `<li><span class="mapping-def-key">${key}:</span> ${formattedValue}</li>`;
        }
    }
    return html;
}

function renderDefinitionValue(value) {
    if (typeof value === 'string') {
        return `<span class="mapping-def-value-string">"${value}"</span>`;
    } else if (Array.isArray(value)) {
        if (value.length === 0) return '[]';
        let html = '<ul>';
        value.forEach((item, index) => {
            html += `<li><span class="mapping-def-key">Item ${index + 1}:</span> ${renderDefinitionValue(item)}</li>`;
        });
        html += '</ul>';
        return html;
    } else if (typeof value === 'object' && value !== null) {
        if (value.type === 'literal' && value.value !== undefined) {
            let valStr = typeof value.value === 'string' ? `"${value.value}"` :
                         typeof value.value === 'boolean' ? `<span class="mapping-def-value-boolean">${value.value}</span>` : value.value;
            return `<span class="mapping-def-value-literal">${valStr} &rarr; global</span>`;
        } else if (value.type === 'column' && value.value !== undefined) {
            let valStr = typeof value.value === 'string' ? `"${value.value}"` : value.value;
            return `<span class="mapping-def-value-column">"${valStr}" &rarr; mapped</span>`;
        } else if (value.is_complex && Array.isArray(value.entries)) {
             let html = `<span class="mapping-def-value-complex">(Complex - ${value.entries.length} entr${value.entries.length === 1 ? 'y' : 'ies'})</span>`;
             if (value.entries.length > 0) {
                html += '<ul>';
                value.entries.forEach((entry, index) => {
                    html += `<li><span class="mapping-def-key">Entry ${index + 1}:</span><ul>${renderDefinitionObject(entry)}</ul></li>`;
                });
                html += '</ul>';
            }
            return html;
        } else if (value.type !== undefined && value.value !== undefined) {
            let valStr = value.value;
            if (typeof valStr === 'string') valStr = `"${valStr}"`;
            else if (typeof valStr === 'boolean') valStr = `<span class="mapping-def-value-boolean">${valStr}</span>`;
            else if (typeof valStr === 'object') valStr = renderDefinitionValue(valStr);

            return `(Type: <span class="mapping-def-value-object">${value.type}</span>, Value: ${valStr})`;
        } else {
            return `<ul>${renderDefinitionObject(value)}</ul>`;
        }
    }
    return String(value);
}

function updateDashboardMappingStatus() {
    console.log("[DEBUG Renderer] updateDashboardMappingStatus called."); // LOG I
    // Log the source of truth for this function
    console.log("[DEBUG Renderer] updateDashboardMappingStatus - appDataCache.mappings:", JSON.parse(JSON.stringify(appDataCache ? appDataCache.mappings : null))); // LOG J

    const mappingStatusTextEl = document.getElementById('mappingStatusText');
    const configureBtn = document.getElementById('configureMappingBtn');
    const viewBtn = document.getElementById('viewMappingBtn');
    const reconfigBtn = document.getElementById('reconfigureMappingBtn');

    if (!mappingStatusTextEl || !configureBtn || !viewBtn || !reconfigBtn) {
        console.warn("[DEBUG Renderer] Dashboard mapping UI elements not found for status update."); // LOG K
        return;
    }

    configureBtn.classList.add('hidden');
    viewBtn.classList.add('hidden');
    reconfigBtn.classList.add('hidden');

    if (appDataCache && appDataCache.projectInfo && appDataCache.projectInfo.length > 0) {
        const activeMapping = appDataCache.mappings && appDataCache.mappings.length > 0 ? appDataCache.mappings[0] : null;
        console.log("[DEBUG Renderer] updateDashboardMappingStatus - activeMapping:", JSON.parse(JSON.stringify(activeMapping))); // LOG L

        if (activeMapping && activeMapping.column_definitions) {
            console.log("[DEBUG Renderer] updateDashboardMappingStatus: Active mapping FOUND with column_definitions."); // LOG M
            let parsedDefinitions;
            try {
                parsedDefinitions = JSON.parse(activeMapping.column_definitions);
            } catch (e) {
                console.error("[DEBUG Renderer] Failed to parse column_definitions from activeMapping:", e, activeMapping.column_definitions); // LOG N
                mappingStatusTextEl.textContent = "Error reading existing mapping config.";
                mappingStatusTextEl.className = "text-sm text-red-600 mb-3";
                configureBtn.classList.remove('hidden');
                return;
            }

            const sourceFile = parsedDefinitions._file_path ? parsedDefinitions._file_path.split(/[/\\]/).pop() : 'Unknown File';
            mappingStatusTextEl.innerHTML = `Metadata currently mapped from: <code class="text-xs bg-gray-100 p-0.5 rounded">${sourceFile}</code> (Mapping: ${activeMapping.mapping_name || 'Default'}).`;
            mappingStatusTextEl.className = "text-sm text-green-700 mb-3";
            viewBtn.classList.remove('hidden');
            reconfigBtn.classList.remove('hidden');
        } else {
            console.log("[DEBUG Renderer] updateDashboardMappingStatus: NO active mapping or no column_definitions."); // LOG O
            mappingStatusTextEl.textContent = "No metadata mapping configured for this project.";
            mappingStatusTextEl.className = "text-sm text-orange-600 mb-3";
            configureBtn.classList.remove('hidden');
        }
    } else {
        console.log("[DEBUG Renderer] updateDashboardMappingStatus: No project loaded (appDataCache.projectInfo missing)."); // LOG P
        mappingStatusTextEl.textContent = "Load or create a project to manage metadata mapping.";
        mappingStatusTextEl.className = "text-sm text-gray-600 mb-3";
    }
}

// --- Pagination for Source Files ---
export function renderPaginatedFiles(page, searchTerm = '') {
    console.log(`[Renderer] renderPaginatedFiles - page: ${page}, search: '${searchTerm}', totalFiles: ${totalFiles}, currentFilesData items: ${(currentFilesData || []).length}`);
    filesCurrentPage = page;
    let dataToPaginate = currentFilesData || [];
    
    if (searchTerm && dataToPaginate.length > 0) {
        dataToPaginate = dataToPaginate.filter(f => f.filename && f.filename.toLowerCase().includes(searchTerm.toLowerCase()));
    }
    const filteredItemCount = dataToPaginate.length;

    const start = (page - 1) * ITEMS_PER_PAGE;
    const end = start + ITEMS_PER_PAGE;
    // If currentFilesData only holds one page from backend, slicing won't work for other pages without fetching.
    const paginatedItems = dataToPaginate.slice(start, end);

    if(filesList) {
        filesList.innerHTML = paginatedItems.length > 0 ? paginatedItems.map(f => `<div class="p-3 bg-gray-50 rounded-md border border-gray-200"><p class="font-medium text-sm text-gray-700">${f.filename} <span class="text-xs text-gray-400">(${f.file_type || 'N/A'})</span></p><p class="text-xs text-gray-500">${f.relative_path || ''} - ${(f.size_bytes / 1024).toFixed(2)} KB - ${f.mime_type || 'unknown'} - Status: ${f.status || 'N/A'}</p></div>`).join('') : '';
    } else { console.error("[Renderer] #metadataFiles element not found!"); }
    
    if(fileCountEl) fileCountEl.textContent = totalFiles; // Display grand total
    if(noFilesMsg) noFilesMsg.style.display = totalFiles === 0 ? 'block' : 'none';
    
    const totalPagesToDisplay = Math.ceil(filteredItemCount / ITEMS_PER_PAGE);
    if (filesPageInfo) filesPageInfo.textContent = `Page ${filesCurrentPage} of ${totalPagesToDisplay || 1} (Displaying ${paginatedItems.length} of ${filteredItemCount} filtered, Total in DB: ${totalFiles})`;
    if (prevFilesPageBtn) prevFilesPageBtn.disabled = filesCurrentPage === 1;
    if (nextFilesPageBtn) nextFilesPageBtn.disabled = filesCurrentPage === totalPagesToDisplay || totalPagesToDisplay === 0;
    
    const filesPaginationControls = document.getElementById('filesPaginationControls');
    if (filesPaginationControls) filesPaginationControls.style.display = totalFiles > 0 ? 'flex' : 'none';
}

// --- Pagination for API Log ---
async function renderPaginatedApiLog(page) {
    console.log(`[Renderer] renderPaginatedApiLog - page: ${page}, totalApiLogEntries: ${totalApiLogEntries}`);
    apiLogCurrentPage = page;
    let paginatedItems = [];
    let currentTotalForDisplay = totalApiLogEntries;

    if (typeof window.electronAPI !== 'undefined' && currentlyLoadedHdpcPath) {
        if(loader) loader.style.display = 'block';
        try {
            // Corrected fetch call with hdpcPath
            const encodedHdpcPath = encodeURIComponent(currentlyLoadedHdpcPath);
            const response = await fetch(`${PYTHON_API_BASE_URL}/api/apilog?page=${page}&limit=${ITEMS_PER_PAGE}&hdpcPath=${encodedHdpcPath}`);

            if (!response.ok) throw new Error(`Failed to fetch API log: ${response.statusText}`);
            const data = await response.json();
            paginatedItems = data.items || [];
            currentTotalForDisplay = data.totalItems || 0;
            console.log(`[Renderer] API Log data fetched for page ${page}:`, paginatedItems.length, "items");
        } catch (error) {
            console.error("Error fetching paginated API log:", error);
            showToast(`Error fetching API log: ${error.message}`, 'error');
        } finally {
            if(loader) loader.style.display = 'none';
        }
    }
    if(apiLogListEl) apiLogListEl.innerHTML = paginatedItems.length > 0 ? paginatedItems.map(log => `<div class="p-2 bg-gray-50 rounded-md border border-gray-200 text-xs"><p><span class="font-medium">${log.http_method}</span> ${log.endpoint_url} - <span class="font-semibold ${log.response_status_code >= 400 ? 'text-red-600' : 'text-green-600'}">${log.response_status_code}</span> (${log.status})</p><p class="text-gray-500">${new Date(log.timestamp).toLocaleString()}</p></div>`).join('') : '';
    else { console.error("[Renderer] #apiLogList element not found!"); }

    if(apiLogCountEl) apiLogCountEl.textContent = currentTotalForDisplay;
    if(noApiLogMsg) noApiLogMsg.style.display = currentTotalForDisplay === 0 ? 'block' : 'none';

    const totalPages = Math.ceil(currentTotalForDisplay / ITEMS_PER_PAGE);
    if (apiLogPageInfo) apiLogPageInfo.textContent = `Page ${apiLogCurrentPage} of ${totalPages || 1}`;

    if (prevApiLogPageBtn) prevApiLogPageBtn.disabled = apiLogCurrentPage === 1;
    if (nextApiLogPageBtn) nextApiLogPageBtn.disabled = apiLogCurrentPage === totalPages || totalPages === 0;
    const apiLogPaginationControls = document.getElementById('apiLogPaginationControls');
    if (apiLogPaginationControls) apiLogPaginationControls.style.display = currentTotalForDisplay > 0 ? 'flex' : 'none';
}

async function fetchAndDisplayDashboardStats() {
    if (!currentlyLoadedHdpcPath) return;
    try {
        const response = await fetch(`${PYTHON_API_BASE_URL}/api/project/dashboard_stats?hdpcPath=${encodeURIComponent(currentlyLoadedHdpcPath)}`);
        if (response.ok) {
            const stats = await response.json();
            if (statsTotalFiles) statsTotalFiles.textContent = stats.total_files || 0;
            if (statsFilesWithMetadata) statsFilesWithMetadata.textContent = stats.files_with_metadata || 0;
            if (statsSandboxRecords) statsSandboxRecords.textContent = `${stats.drafts_sandbox || 0} / ${stats.published_sandbox || 0}`;
            if (statsProductionRecords) statsProductionRecords.textContent = `${stats.drafts_production || 0} / ${stats.published_production || 0}`;
        }
    } catch (error) {
        console.error("Error fetching dashboard stats:", error);
    }
}

async function saveProjectDescription() {
    const newDescription = projectDescriptionTextarea.value;
    try {
        const response = await fetch(`${PYTHON_API_BASE_URL}/api/project/update_description`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ description: newDescription, hdpcPath: currentlyLoadedHdpcPath })
        });
        const result = await response.json();
        if (result.success) {
            showToast("Description updated successfully!", "success");
            document.getElementById('overviewDescription').textContent = newDescription;
            if (editDescriptionModal) editDescriptionModal.classList.add('hidden');
            // Update cache
            if (appDataCache && appDataCache.projectInfo && appDataCache.projectInfo[0]) {
                appDataCache.projectInfo[0].description = newDescription;
            }
        } else {
            throw new Error(result.error);
        }
    } catch (error) {
        showToast(`Error: ${error.message}`, 'error');
    }
}

async function saveProjectTitle() {
    const newTitle = projectTitleInput.value;
    if (!newTitle) {
        showToast("Project title cannot be empty.", 'error');
        return;
    }
    try {
        const response = await fetch(`${PYTHON_API_BASE_URL}/api/project/update_title`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: newTitle, hdpcPath: currentlyLoadedHdpcPath })
        });
        const result = await response.json();
        if (result.success) {
            showToast("Title updated successfully!", "success");
            document.getElementById('overviewProjectName').textContent = newTitle;
            if (editTitleModal) editTitleModal.classList.add('hidden');
            // Update cache
            if (appDataCache && appDataCache.projectInfo && appDataCache.projectInfo[0]) {
                appDataCache.projectInfo[0].project_name = newTitle;
            }
        } else {
            throw new Error(result.error);
        }
    } catch (error) {
        showToast(`Error: ${error.message}`, 'error');
    }
}

async function fetchAndDisplayPublishedRecords() {
    if (!currentlyLoadedHdpcPath) return;

    try {
        const response = await fetch(`${PYTHON_API_BASE_URL}/api/project/published_records?hdpcPath=${encodeURIComponent(currentlyLoadedHdpcPath)}`);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const records = await response.json();

        if (latestPublishedList) {
            if (records && records.length > 0) {
                latestPublishedList.innerHTML = records.map(record => `
                    <div class="p-2 bg-gray-50 rounded-md border border-gray-200">
                        <p class="font-medium text-sm text-gray-800">${record.record_title || 'Untitled'}</p>
                        <div class="flex justify-between items-center text-xs text-gray-500 mt-1">
                            <span>${new Date(record.publication_date).toLocaleDateString()}</span>
                            <a href="${record.is_sandbox ? 'https://zenodo.org/records/' : 'https://sandbox.zenodo.org/records/'}${record.zenodo_record_id}" target="_blank" class="text-blue-600 hover:underline">${record.zenodo_doi || 'No DOI'}</a>
                        </div>
                    </div>
                `).join('');
            } else {
                latestPublishedList.innerHTML = '<p class="text-gray-500">No published records found.</p>';
            }
        }

    } catch (error) {
        console.error("Error fetching latest published records:", error);
        if (latestPublishedList) {
            latestPublishedList.innerHTML = '<p class="text-red-500">Error loading records.</p>';
        }
    }
}

// --- Initialization ---
export function initDashboard() {
    // Event listeners are already attached in the main renderer.js,
    // but having them here makes the module self-contained.
    if (prevFilesPageBtn) prevFilesPageBtn.addEventListener('click', () => {
        if (filesCurrentPage > 1) {
            renderPaginatedFiles(filesCurrentPage - 1, fileSearchInput.value);
        }
    });
    if (nextFilesPageBtn) nextFilesPageBtn.addEventListener('click', () => {
        const searchTerm = fileSearchInput ? fileSearchInput.value : '';
        const filteredData = (currentFilesData || []).filter(f => f.filename && f.filename.toLowerCase().includes(searchTerm.toLowerCase()));
        if (filesCurrentPage < Math.ceil(filteredData.length / ITEMS_PER_PAGE)) {
            renderPaginatedFiles(filesCurrentPage + 1, searchTerm);
        }
    });
    if (fileSearchInput) fileSearchInput.addEventListener('input', () => renderPaginatedFiles(1, fileSearchInput.value));
    if (prevApiLogPageBtn) prevApiLogPageBtn.addEventListener('click', () => {
        if (apiLogCurrentPage > 1) {
            renderPaginatedApiLog(apiLogCurrentPage - 1);
        }
    });
    if (nextApiLogPageBtn) nextApiLogPageBtn.addEventListener('click', () => {
        if (apiLogCurrentPage < Math.ceil(totalApiLogEntries / ITEMS_PER_PAGE)) {
            renderPaginatedApiLog(apiLogCurrentPage + 1);
        }
    });

    if (editProjectDescriptionBtn) {
        editProjectDescriptionBtn.addEventListener('click', () => {
            if (projectDescriptionTextarea) {
                projectDescriptionTextarea.value = document.getElementById('overviewDescription').textContent;
            }
            if (editDescriptionModal) {
                editDescriptionModal.classList.remove('hidden');
            }
        });
    }

    if (closeEditDescriptionModalBtn) {
        closeEditDescriptionModalBtn.addEventListener('click', () => {
            if (editDescriptionModal) editDescriptionModal.classList.add('hidden');
        });
    }

    if (cancelEditDescriptionBtn) {
        cancelEditDescriptionBtn.addEventListener('click', () => {
            if (editDescriptionModal) editDescriptionModal.classList.add('hidden');
        });
    }

    if (saveDescriptionBtn) {
        saveDescriptionBtn.addEventListener('click', saveProjectDescription);
    }

    if (editProjectTitleBtn) {
        editProjectTitleBtn.addEventListener('click', () => {
            if (projectTitleInput) {
                projectTitleInput.value = document.getElementById('overviewProjectName').textContent;
            }
            if (editTitleModal) {
                editTitleModal.classList.remove('hidden');
            }
        });
    }

    if (closeEditTitleModalBtn) {
        closeEditTitleModalBtn.addEventListener('click', () => {
            if (editTitleModal) editTitleModal.classList.add('hidden');
        });
    }

    if (cancelEditTitleBtn) {
        cancelEditTitleBtn.addEventListener('click', () => {
            if (editTitleModal) editTitleModal.classList.add('hidden');
        });
    }

    if (saveTitleBtn) {
        saveTitleBtn.addEventListener('click', saveProjectTitle);
    }
}