// js/views/pipelineComponents.js

import { PYTHON_API_BASE_URL } from '../core/api.js';
import { showToast } from '../core/ui.js';
import { navigateToView } from '../core/navigation.js';

// --- DOM Elements ---
const pipelineComponentsBtn = document.getElementById('pipelineComponentsBtn');
const pipelineComponentsContainer = document.getElementById('pipelineComponentsContainer');
const infoModal = document.getElementById('infoModal');
const closeInfoModalBtn = document.getElementById('closeInfoModalBtn');
const infoModalTitle = document.getElementById('infoModalTitle');
const infoModalBody = document.getElementById('infoModalBody');
const optionsModal = document.getElementById('optionsModal');
const closeOptionsModalBtn = document.getElementById('closeOptionsModalBtn');
const optionsModalTitle = document.getElementById('optionsModalTitle');
const optionsModalBody = document.getElementById('optionsModalBody');
const closeOptionsModalFooterBtn = document.getElementById('closeOptionsModalFooterBtn');
const saveComponentOptionsBtn = document.getElementById('saveComponentOptionsBtn');

// --- Constants & State ---
let COMPONENT_API_BASE;
let installationInProgress = false; // Local state for this view

// --- Core Functions ---

export async function loadAndDisplayPipelineComponents() {
    if (installationInProgress) {
        console.log('[Components] Skipping refresh - installation in progress');
        return;
    }

    if (!pipelineComponentsContainer) return;
    pipelineComponentsContainer.innerHTML = '<p class="text-gray-500">Loading components...</p>';

    try {
        const response = await fetch(COMPONENT_API_BASE);
        if (!response.ok) {
            throw new Error(`Failed to fetch pipeline components: ${response.statusText}`);
        }
        const componentsData = await response.json();
        
        const metadata = componentsData.metadata || {};
        delete componentsData.metadata;
        
        const categories = Object.keys(componentsData).sort();
        
        pipelineComponentsContainer.innerHTML = ''; // Clear loading message
        
        const headerDiv = document.createElement('div');
        headerDiv.className = 'mb-6 p-4 bg-blue-50 rounded-lg border border-blue-200';
        headerDiv.innerHTML = `
            <h2 class="text-xl font-bold text-blue-800 mb-2">Pipeline Components</h2>
            <div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div class="text-center"><div class="font-semibold text-blue-600">${metadata.total_installed || 0}</div><div class="text-gray-600">Installed</div></div>
                <div class="text-center"><div class="font-semibold text-green-600">${metadata.total_available || 0}</div><div class="text-gray-600">Available</div></div>
                <div class="text-center"><div class="font-semibold text-purple-600">${categories.length}</div><div class="text-gray-600">Categories</div></div>
                <div class="text-center"><button id="optimizeBtn" class="btn-secondary text-xs py-1 px-2">Optimize</button><div class="text-gray-600">Storage</div></div>
            </div>
        `;
        pipelineComponentsContainer.appendChild(headerDiv);
        
        document.getElementById('optimizeBtn').addEventListener('click', optimizeComponents);

        const searchContainer = document.createElement('div');
        searchContainer.className = 'component-view-search-container';
        searchContainer.innerHTML = `
            <div class="search-icon">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path fill-rule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clip-rule="evenodd" />
                </svg>
            </div>
            <input type="text" id="mainComponentSearchInput" placeholder="Search by name, category, or description...">
        `;
        pipelineComponentsContainer.appendChild(searchContainer);

        const searchInput = document.getElementById('mainComponentSearchInput');
        searchInput.addEventListener('input', (e) => {
            const searchTerm = e.target.value.toLowerCase();
            
            // Iterate over each category section
            pipelineComponentsContainer.querySelectorAll('.collapsible-content').forEach(contentDiv => {
                let visibleInCategory = 0;
                const cards = contentDiv.querySelectorAll('.component-card');
                
                // Filter cards within the category
                cards.forEach(card => {
                    const cardText = card.textContent.toLowerCase();
                    const isMatch = cardText.includes(searchTerm);
                    card.classList.toggle('hidden', !isMatch);
                    if (isMatch) {
                        visibleInCategory++;
                    }
                });

                // Hide the entire category header if no cards within it match
                const header = contentDiv.previousElementSibling;
                if (header && header.classList.contains('collapsible-header')) {
                    header.classList.toggle('hidden', visibleInCategory === 0);
                }
            });
        });

        // Create component sections
        categories.forEach(category => {
            const components = componentsData[category];
            if (!components || components.length === 0) return;
            
            const collapsibleId = `collapsible-${category.replace(/\s+/g, '-')}`;
            const header = document.createElement('div');
            header.className = 'collapsible-header';
            header.innerHTML = `
                <h3 class="text-lg font-semibold text-gray-700">${category}</h3>
                <span class="flex items-center">
                    <span class="text-sm text-gray-500 mr-2">${components.length} component${components.length !== 1 ? 's' : ''}</span>
                    <span class="collapse-arrow transform transition-transform">▼</span>
                </span>
            `;
            
            const content = document.createElement('div');
            content.id = collapsibleId;
            content.className = 'collapsible-content grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4';
            content.style.display = 'none';

            components.forEach(component => {
                const card = createComponentCard(component);
                content.appendChild(card);
            });
            
            pipelineComponentsContainer.appendChild(header);
            pipelineComponentsContainer.appendChild(content);

            // Toggle functionality
            header.addEventListener('click', () => {
                header.classList.toggle('active');
                const icon = header.querySelector('.collapse-arrow');
                if (content.style.display === "grid") {
                    content.style.display = "none";
                    icon.style.transform = 'rotate(0deg)';
                } else {
                    content.style.display = "grid";
                    icon.style.transform = 'rotate(180deg)';
                }
            });
        });

    } catch (error) {
        console.error("Error loading pipeline components:", error);
        pipelineComponentsContainer.innerHTML = `<p class="text-red-500">Error: ${error.message}</p>`;
    }
}

function createComponentCard(component) {
    const card = document.createElement('div');
    const isInstalled = component.status === 'installed';
    const statusColor = isInstalled ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800';
    
    card.className = `component-card ${isInstalled ? 'border-green-200' : 'border-blue-200'}`;
    card.dataset.componentName = component.name;
    
    card.innerHTML = `
        <div class="component-card-header">
            <div class="flex justify-between items-start mb-2">
                <h4 class="font-bold text-md">${component.label || component.name}</h4>
                <span class="text-xs px-2 py-1 rounded ${statusColor}">${component.status}</span>
            </div>
            <p class="text-sm text-gray-600 mb-3 line-clamp-2">${component.description || 'No description available'}</p>
            <div class="text-xs text-gray-500 mb-3">
                <div>Version: ${component.version || '1.0.0'}</div>
                ${component.is_valid === false ? '<div class="text-red-500">⚠️ Invalid component</div>' : ''}
            </div>
        </div>
        <div class="card-actions">
            <button class="info-btn btn-secondary flex-1">Info</button>
            ${isInstalled ? 
                `<button class="run-btn" title="Run Component">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 010 1.972l-11.54 6.347a1.168 1.168 0 01-1.667-.986V5.653z" />
                    </svg>
                 </button>
                 <button class="config-btn btn-primary flex-1">Config</button>
                 <button class="uninstall-btn" title="Uninstall">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                    </svg>
                 </button>` :
                `<button class="install-btn btn-primary flex-1">Install</button>`
            }
        </div>
    `;
    
    // Event listeners
    card.querySelector('.info-btn').addEventListener('click', () => showInfoModal(component));
    
    if (isInstalled) {
        card.querySelector('.run-btn').addEventListener('click', () => {
            if (window.componentRunManager) {
                window.componentRunManager.showRunModal(component);
            } else {
                showToast('Component run manager not initialized', 'error');
            }
        });
        
        card.querySelector('.config-btn').addEventListener('click', () => showConfigModal(component));
        card.querySelector('.uninstall-btn').addEventListener('click', () => uninstallComponent(component));
    } else {
        card.querySelector('.install-btn').addEventListener('click', () => {
            if (window.componentInstallationManager) {
                // Use enhanced installation with requirements
                window.componentInstallationManager.showInstallModal(component);
            } else {
                // Fallback to simple installation
                console.warn('Installation manager not available, using fallback');
                installComponent(component);
            }
        });
    }
    
    return card;
}

export async function showInfoModal(component) {
    // Set modal title
    if (infoModalTitle) {
        infoModalTitle.textContent = component.label || component.name;
    }
    
    if (infoModalBody) {
        infoModalBody.innerHTML = '<p class="text-gray-500">Loading component information...</p>';
    }
    
    if (infoModal) {
        infoModal.classList.remove('hidden');
    }
    
    try {
        // Get full component details from the discovery system
        const response = await fetch(`${PYTHON_API_BASE_URL}/api/pipeline_components`);
        const allComponents = await response.json();
        
        let fullComponent = null;
        
        // Find the complete component definition
        Object.keys(allComponents).forEach(category => {
            if (category !== 'metadata') {
                allComponents[category].forEach(comp => {
                    if (comp.name === component.name) {
                        fullComponent = { ...comp, category: category };
                    }
                });
            }
        });
        
        if (!fullComponent) {
            throw new Error('Component details not found');
        }
        
        // Render complete component information
        const inputs = fullComponent.inputs || [];
        const outputs = fullComponent.outputs || [];
        const requirements = fullComponent.requirements || {};
        const params = fullComponent.params || [];
        
        infoModalBody.innerHTML = `
            <div class="space-y-6">
                <!-- Description Section -->
                <div class="info-section">
                    <h4 class="font-semibold text-gray-700 mb-2 flex items-center">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5 mr-2">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
                        </svg>
                        Description
                    </h4>
                    <p class="text-gray-600 leading-relaxed">${fullComponent.description || 'No description available.'}</p>
                </div>
                
                <!-- Basic Information -->
                <div class="info-section">
                    <h4 class="font-semibold text-gray-700 mb-3">Component Details</h4>
                    <div class="grid md:grid-cols-2 gap-4 text-sm">
                        <div><span class="font-medium text-gray-500">Name:</span> <code class="bg-gray-100 px-2 py-1 rounded">${fullComponent.name}</code></div>
                        <div><span class="font-medium text-gray-500">Category:</span> <span class="text-gray-700">${fullComponent.category}</span></div>
                        <div><span class="font-medium text-gray-500">Version:</span> <span class="text-gray-700">${fullComponent.version || '1.0.0'}</span></div>
                        <div><span class="font-medium text-gray-500">Status:</span> <span class="inline-flex px-2 py-1 text-xs rounded-full ${fullComponent.status === 'installed' ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'}">${fullComponent.status || 'available'}</span></div>
                    </div>
                </div>
                
                <!-- Inputs Section -->
                <div class="info-section">
                    <h4 class="font-semibold text-gray-700 mb-3 flex items-center">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5 mr-2">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M9 8.25H7.5a2.25 2.25 0 00-2.25 2.25v9a2.25 2.25 0 002.25 2.25h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25H15m0-3l-3-3-3 3m6 0l-3-3-3 3m6 0v3" />
                        </svg>
                        Inputs (${inputs.length})
                    </h4>
                    ${inputs.length > 0 ? 
                        `<div class="space-y-3">
                            ${inputs.map(input => `
                                <div class="border border-gray-200 rounded-lg p-3 bg-gray-50">
                                    <div class="flex items-center justify-between mb-2">
                                        <span class="font-medium text-gray-800">${input.name}</span>
                                        ${input.required ? '<span class="text-xs bg-red-100 text-red-700 px-2 py-1 rounded">Required</span>' : '<span class="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded">Optional</span>'}
                                    </div>
                                    <p class="text-sm text-gray-600 mb-2">${input.description || 'No description'}</p>
                                    <div class="text-xs text-gray-500">
                                        <span>Type: <code>${input.data_type_tag || 'unknown'}</code></span>
                                        ${input.validation_rules?.file_extensions ? 
                                            `<span class="ml-3">Extensions: ${input.validation_rules.file_extensions.join(', ')}</span>` : ''}
                                    </div>
                                </div>
                            `).join('')}
                        </div>` :
                        '<p class="text-sm text-gray-500">No inputs defined</p>'
                    }
                </div>
                
                <!-- Outputs Section -->
                <div class="info-section">
                    <h4 class="font-semibold text-gray-700 mb-3 flex items-center">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5 mr-2">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M9 8.25H7.5a2.25 2.25 0 00-2.25 2.25v9a2.25 2.25 0 002.25 2.25h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25H15M9 12l2 2 4-4m6-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        Outputs (${outputs.length})
                    </h4>
                    ${outputs.length > 0 ? 
                        `<div class="space-y-3">
                            ${outputs.map(output => `
                                <div class="border border-gray-200 rounded-lg p-3 bg-green-50">
                                    <div class="font-medium text-gray-800 mb-2">${output.name_pattern || output.name || 'Output'}</div>
                                    <p class="text-sm text-gray-600 mb-2">${output.description || 'No description'}</p>
                                    <div class="text-xs text-gray-500">
                                        <span>Type: <code>${output.type || 'unknown'}</code></span>
                                        <span class="ml-3">Category: ${output.category || 'general'}</span>
                                    </div>
                                </div>
                            `).join('')}
                        </div>` :
                        '<p class="text-sm text-gray-500">No outputs defined</p>'
                    }
                </div>
                
                <!-- Parameters Section -->
                ${params.length > 0 ? `
                <div class="info-section">
                    <h4 class="font-semibold text-gray-700 mb-3 flex items-center">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5 mr-2">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.646.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 1.255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.333.183-.582.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-1.255c.007-.378-.137-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" /><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                        Parameters (${params.length})
                    </h4>
                    <div class="space-y-2">
                        ${params.map(param => `
                            <div class="flex items-center justify-between p-2 bg-blue-50 rounded border">
                                <div>
                                    <span class="font-medium text-gray-800">${param.label || param.name}</span>
                                    <span class="text-xs text-gray-500 ml-2">(${param.type})</span>
                                    ${param.help_text ? `<p class="text-xs text-gray-600 mt-1">${param.help_text}</p>` : ''}
                                </div>
                                <code class="text-xs bg-white px-2 py-1 rounded border">${JSON.stringify(param.default)}</code>
                            </div>
                        `).join('')}
                    </div>
                </div>` : ''}
                
                <!-- Requirements Section -->
                <div class="info-section border-t pt-4">
                    <h4 class="font-semibold text-gray-700 mb-3">Requirements</h4>
                    <div class="grid md:grid-cols-2 gap-3 text-sm">
                        <div><span class="font-medium text-gray-500">Python:</span> <code>${requirements.python_version || '>=3.8'}</code></div>
                        <div><span class="font-medium text-gray-500">Timeout:</span> ${fullComponent.execution?.timeout_seconds || 60}s</div>
                        <div><span class="font-medium text-gray-500">Memory:</span> ${fullComponent.execution?.memory_limit_mb || 512}MB</div>
                        <div><span class="font-medium text-gray-500">CPU:</span> ${fullComponent.execution?.cpu_limit || 1} core(s)</div>
                    </div>
                </div>
            </div>
        `;
        
    } catch (error) {
        console.error('Error loading component info:', error);
        if (infoModalBody) {
            infoModalBody.innerHTML = `<p class="text-red-500">Error loading component information: ${error.message}</p>`;
        }
    }
}

/**
 * Renders the HTML for the read-only inputs section inside the 'Configure' modal.
 * This is a helper for showConfigModal.
 * @param {Array} componentInputs - The list of input definitions from component.yaml.
 * @param {string} stepId - The ID of the current pipeline step.
 * @returns {string} - The complete HTML string for the inputs section.
 */
function _renderConfigModalInputs(componentInputs, stepId) {
    if (!componentInputs || componentInputs.length === 0) {
        return ''; // No inputs to render
    }

    // Use the global pipelineConstructor instance to find the step
    const step = window.pipelineConstructor.findStepById(stepId);
    if (!step) return '';

    let anyRequiredMissing = false;

    const inputRowsHtml = componentInputs.map(input => {
        const mapping = step.inputMapping?.[input.name];
        let mappingText = '<span class="text-sm text-gray-500 italic">Not Mapped</span>';

        if (mapping?.sourceType === 'pipelineFile') {
            // Use the global instance to find the file
            const sourceFile = window.pipelineConstructor.findFileById(mapping.fileId);
            mappingText = `Mapped to: <code class="text-sm font-medium text-blue-600">${sourceFile?.name || 'Unknown File'}</code>`;
        } else if (mapping) {
            mappingText = `<span class="text-sm font-medium text-green-600">Mapped (${mapping.sourceType})</span>`;
        }

        if (input.required && !mapping) {
            anyRequiredMissing = true;
        }

        return `
            <div class="flex justify-between items-center p-2 bg-gray-50 rounded-md">
                <label class="font-medium text-gray-700">
                    ${input.label || input.name} ${input.required ? '<span class="text-red-500">*</span>' : ''}
                </label>
                <div class="text-right">${mappingText}</div>
            </div>
        `;
    }).join('');

    const hintHtml = anyRequiredMissing 
        ? `<p id="requiredInputHint" class="text-xs text-amber-600 mt-2">
               <span class="font-bold">Note:</span> One or more required inputs (*) are not yet mapped.
           </p>` 
        : '';

    return `
        <div class="mb-6 border-b pb-4">
            <div class="flex justify-between items-center mb-3">
                <h4 class="text-lg font-semibold text-gray-800">Inputs</h4>
                <button class="btn-secondary text-sm" id="remapInputsBtn" data-step-id="${stepId}">Configure Inputs...</button>
            </div>
            <div class="space-y-1">${inputRowsHtml}</div>
            ${hintHtml}
        </div>
    `;
}

export async function showConfigModal(component, stepId) {
    console.log('showConfigModal (constructor context) called for:', { componentName: component.name, stepId });

    optionsModalTitle.textContent = `Configure ${component.label || component.name}`;
    optionsModalBody.innerHTML = '<p class="text-gray-500 p-4">Loading configuration...</p>';
    optionsModal.classList.remove('hidden');

    try {
        const response = await fetch(`${COMPONENT_API_BASE}/${component.name}/config`);
        if (!response.ok) throw new Error(`Failed to fetch component config: ${response.statusText}`);

        const configData = await response.json();

        // Render and prepend the new Inputs section using the standalone helper
        const inputsHtml = _renderConfigModalInputs(configData.inputs || [], stepId);
        optionsModalBody.innerHTML = inputsHtml;

        // Attach listener to the new "Configure Inputs" button
        const remapBtn = optionsModalBody.querySelector('#remapInputsBtn');
        if(remapBtn) {
            remapBtn.addEventListener('click', () => {
                optionsModal.classList.add('hidden'); // Close current modal
                // Call the method on the global pipelineConstructor instance
                window.pipelineConstructor.showInputMappingModal(stepId, component); 
            });
        }

        // Create a container for the parameters section and append it
        const parametersContainer = document.createElement('div');
        optionsModalBody.appendChild(parametersContainer);

        // Populate the parameters section (logic remains the same)
        const parameterGroups = configData.parameter_groups;
        const legacyParameters = configData.parameters;
        let hasParameters = false;

        if (parameterGroups && Array.isArray(parameterGroups) && parameterGroups.length > 0) {
            hasParameters = true;
            parameterGroups.forEach(group => {
                const fieldset = document.createElement('fieldset');
                fieldset.className = 'parameter-group pt-4 mt-4';
                let fieldsetHTML = `
                    <legend class="text-md font-semibold text-gray-700">${group.title}</legend>
                    <p class="text-sm text-gray-500 mb-4">${group.description || ''}</p>`;
                (group.parameters || []).forEach(param => {
                    fieldsetHTML += window.componentRunManager.buildParameterInput(param); 
                });
                fieldset.innerHTML = fieldsetHTML;
                parametersContainer.appendChild(fieldset);
            });
        } else if (legacyParameters && Array.isArray(legacyParameters) && legacyParameters.length > 0) {
            hasParameters = true;
            const fieldset = document.createElement('fieldset');
            fieldset.className = 'parameter-group';
            fieldset.innerHTML = `<legend class="text-md font-semibold text-gray-700">Parameters</legend>`;
            legacyParameters.forEach(param => {
                fieldset.innerHTML += window.componentRunManager.buildParameterInput(param);
            });
            parametersContainer.appendChild(fieldset);
        }

        if (!hasParameters) {
            parametersContainer.innerHTML = '<p class="text-gray-500 mt-4">This component has no configurable parameters.</p>';
            document.getElementById('saveComponentOptionsBtn').style.display = 'none';
        } else {
             document.getElementById('saveComponentOptionsBtn').style.display = 'inline-block';
             window.componentRunManager.attachDynamicParameterListeners();

             parametersContainer.querySelectorAll('.configure-data-mapping-btn').forEach(button => {
                button.addEventListener('click', (e) => {
                    const paramName = e.target.dataset.paramName;
                    window.componentRunManager.openDataMappingModal(paramName, {
                        context: 'constructor',
                        stepId: stepId
                    });
                });
             });
        }

        window.pipelineConstructor.setupConfigSaveHandler(component, legacyParameters || [], stepId);

    } catch (error) {
        console.error("Error loading component config:", error);
        optionsModalBody.innerHTML = `<p class="text-red-500">Error: ${error.message}</p>`;
    }
}

async function installComponent(component) {
    try {
        showToast(`Installing ${component.name}...`, 'info', 5000);
        
        const response = await fetch(`${COMPONENT_API_BASE}/install`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ component_name: component.name })
        });

        const result = await response.json();
        
        if (result.success) {
            showToast(`${component.name} installed successfully!`, 'success');
            loadAndDisplayPipelineComponents();
        } else {
            throw new Error(result.error || 'Installation failed');
        }

    } catch (error) {
        console.error('Error installing component:', error);
        showToast(`Installation failed: ${error.message}`, 'error');
    }
}

async function uninstallComponent(component) {
    if (!confirm(`Are you sure you want to uninstall ${component.name}?`)) {
        return;
    }
    
    try {
        showToast(`Uninstalling ${component.name}...`, 'info', 5000);
        
        const response = await fetch(`${COMPONENT_API_BASE}/uninstall`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ component_name: component.name })
        });

        const result = await response.json();
        
        if (result.success) {
            showToast(`${component.name} uninstalled successfully!`, 'success');
            loadAndDisplayPipelineComponents();
        } else {
            throw new Error(result.error || 'Uninstallation failed');
        }

    } catch (error) {
        console.error('Error uninstalling component:', error);
        showToast(`Uninstallation failed: ${error.message}`, 'error');
    }
}

async function optimizeComponents() {
    try {
        showToast('Optimizing component dependencies...', 'info', 10000);
        
        const response = await fetch(`${COMPONENT_API_BASE}/optimize`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });

        const result = await response.json();
        
        if (result.success) {
            const stats = result.storage_stats;
            let message = 'Dependencies optimized successfully!';
            if (stats && stats.estimated_savings_mb) {
                message += ` Saved ~${stats.estimated_savings_mb.toFixed(1)}MB`;
            }
            showToast(message, 'success');
        } else {
            throw new Error(result.error || 'Optimization failed');
        }

    } catch (error) {
        console.error('Error optimizing components:', error);
        showToast(`Optimization failed: ${error.message}`, 'error');
    }
}

// --- Initialization ---
export function initPipelineComponents() {
    COMPONENT_API_BASE = `${PYTHON_API_BASE_URL}/api/pipeline_components`;
    
    if (pipelineComponentsBtn) {
        pipelineComponentsBtn.addEventListener('click', () => {
            navigateToView('pipeline-components');
            loadAndDisplayPipelineComponents();
        });
    }
    if (closeInfoModalBtn) {
        closeInfoModalBtn.addEventListener('click', () => infoModal.classList.add('hidden'));
    }
    if (closeOptionsModalBtn) {
        closeOptionsModalBtn.addEventListener('click', () => optionsModal.classList.add('hidden'));
    }
    if (closeOptionsModalFooterBtn) {
        closeOptionsModalFooterBtn.addEventListener('click', () => optionsModal.classList.add('hidden'));
    }
}

export function setInstallationStatus(status) {
    installationInProgress = status;
}