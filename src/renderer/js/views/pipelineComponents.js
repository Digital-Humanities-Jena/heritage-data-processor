// src/renderer/js/views/pipelineComponents.js
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
// ----- Update Components Modal
const updateCheckModal = document.getElementById('updateCheckModal');
const closeUpdateCheckModalBtn = document.getElementById('closeUpdateCheckModalBtn');
const closeUpdateCheckModalFooterBtn = document.getElementById('closeUpdateCheckModalFooterBtn');
const updateCheckModalBody = document.getElementById('updateCheckModalBody');
// ----- Changelog of Component Modal
const changelogModal = document.getElementById('componentChangelogModal');
const closeChangelogBtn = document.getElementById('closeComponentChangelogBtn');
const closeChangelogFooterBtn = document.getElementById('closeComponentChangelogFooterBtn');
const changelogModalTitle = document.getElementById('componentChangelogModalTitle');
const changelogModalBody = document.getElementById('componentChangelogModalBody');
// ----- Download Components Modal
const downloadComponentsModal = document.getElementById('downloadComponentsModal');
const closeDownloadComponentsBtn = document.getElementById('closeDownloadComponentsBtn');
const closeDownloadComponentsFooterBtn = document.getElementById('closeDownloadComponentsFooterBtn');
const downloadableComponentsContainer = document.getElementById('downloadableComponentsContainer');


// --- Constants & State ---
let COMPONENT_API_BASE;
let installationInProgress = false; // Local state for this view

// --- Helper Functions ---
/**
 * Polls the backend until a component is confirmed to exist or a timeout is reached.
 * @param {string} componentName The name of the component to check for.
 * @param {number} timeout The maximum time to wait in milliseconds.
 * @returns {Promise<boolean>} A promise that resolves to true if the component is found.
 */
function waitForComponent(componentName, timeout = 5000) {
    return new Promise((resolve, reject) => {
        const intervalTime = 300;
        let elapsedTime = 0;

        const interval = setInterval(async () => {
            try {
                const response = await fetch(`${COMPONENT_API_BASE}/${componentName}/exists`);
                const result = await response.json();
                if (result.exists) {
                    clearInterval(interval);
                    resolve(true);
                } else {
                    elapsedTime += intervalTime;
                    if (elapsedTime >= timeout) {
                        clearInterval(interval);
                        reject(new Error(`Component '${componentName}' not detected on server after ${timeout}ms.`));
                    }
                }
            } catch (error) {
                clearInterval(interval);
                reject(error);
            }
        }, intervalTime);
    });
}

// --- Core Functions ---
export async function loadAndDisplayPipelineComponents() {
    if (installationInProgress) {
        console.log('[Components] Skipping refresh - installation in progress');
        return;
    }

    if (!pipelineComponentsContainer) return;
    pipelineComponentsContainer.innerHTML = '<p class="text-gray-500">Verifying component integrity...</p>';

    try {
        // Step 1: Run the health check first to clean up any inconsistencies.
        const healthResponse = await fetch(`${COMPONENT_API_BASE}/health_check`, { method: 'POST' });
        const healthResult = await healthResponse.json();

        if (!healthResponse.ok) {
            // If the health check itself fails, show an error but still try to load the components.
            showToast(`Component health check failed: ${healthResult.error || 'Unknown error'}`, 'error');
        } else if (healthResult.cleaned_components && healthResult.cleaned_components.length > 0) {
            // If components were cleaned up, notify the user.
            showToast(healthResult.message, 'info', 5000);
        }

        // Step 2: Now, fetch and display the (potentially cleaned) list of components.
        pipelineComponentsContainer.innerHTML = '<p class="text-gray-500">Loading components...</p>';
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
                <div class="text-center">
                    <button id="optimizeBtn" class="btn-secondary text-xs py-1 px-2">Optimize</button>
                    <button id="updateCheckBtn" class="btn-secondary text-xs py-1 px-2 ml-1">Check for Updates</button>
                    <button id="downloadNewBtn" class="btn-primary text-xs py-1 px-2 ml-1">Download Components</button>
                </div>
            </div>
        `;
        pipelineComponentsContainer.appendChild(headerDiv);
        
        document.getElementById('optimizeBtn').addEventListener('click', optimizeComponents);
        document.getElementById('updateCheckBtn').addEventListener('click', () => checkForUpdates(false));
        document.getElementById('downloadNewBtn').addEventListener('click', showDownloadModal);

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
            pipelineComponentsContainer.querySelectorAll('.collapsible-content').forEach(contentDiv => {
                let visibleInCategory = 0;
                const cards = contentDiv.querySelectorAll('.component-card');
                cards.forEach(card => {
                    const cardText = card.textContent.toLowerCase();
                    const isMatch = cardText.includes(searchTerm);
                    card.classList.toggle('hidden', !isMatch);
                    if (isMatch) {
                        visibleInCategory++;
                    }
                });
                const header = contentDiv.previousElementSibling;
                if (header && header.classList.contains('collapsible-header')) {
                    header.classList.toggle('hidden', visibleInCategory === 0);
                }
            });
        });

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
    const isInvalid = component.is_valid === false;
    const errorTooltip = isInvalid ? `Fix validation errors before installing: ${component.validation_errors.join('; ')}` : '';
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
                
                ${isInvalid ? 
                    `<button 
                        class="invalid-component-details-btn text-red-600 font-semibold mt-1 text-left hover:text-red-800 transition-colors"
                        data-errors='${JSON.stringify(component.validation_errors).replace(/'/g, "&apos;")}'
                     >
                        ⚠️ Invalid: ${component.validation_errors[0]}
                     </button>` 
                    : ''
                }
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
                `<button class="install-btn btn-primary flex-1" ${isInvalid ? `disabled title="${errorTooltip}"` : ''}>Install</button>`
            }
        </div>
    `;

    const invalidDetailsBtn = card.querySelector('.invalid-component-details-btn');
    if (invalidDetailsBtn) {
        invalidDetailsBtn.addEventListener('click', (e) => {
            // Retrieve the full error list from the data attribute
            const errors = JSON.parse(e.currentTarget.dataset.errors);
            
            // Format the errors for display in an alert
            const errorMessage = `The component '${component.label}' has the following validation errors:\n\n- ${errors.join('\n- ')}`;
            alert(errorMessage);
        });
    }
    
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
        const installBtn = card.querySelector('.install-btn');
        // Only add the click listener if the button is not disabled
        if (installBtn && !installBtn.disabled) {
            installBtn.addEventListener('click', () => {
                if (window.componentInstallationManager) {
                    window.componentInstallationManager.showInstallModal(component);
                } else {
                    console.warn('Installation manager not available, using fallback');
                    installComponent(component);
                }
            });
        }
    }
    
    return card;
}

export async function showInfoModal(component) {
    if (infoModalTitle) infoModalTitle.textContent = component.label || component.name;
    if (infoModalBody) infoModalBody.innerHTML = '<p class="text-gray-500">Loading component information...</p>';
    if (infoModal) infoModal.classList.remove('hidden');

    try {
        const fullComponent = component;

        // --- Helper Rendering Functions ---

        const renderAuthors = (authors) => {
            if (!authors || authors.length === 0) return '<p class="text-sm text-gray-500">No authors listed.</p>';
            return authors.map(author => `
                <div class="p-2 bg-gray-50 rounded-md text-sm">
                    <p class="font-semibold text-gray-800">${author.name}</p>
                    ${author.affiliation ? `<p class="text-xs text-gray-600">${author.affiliation}</p>` : ''}
                    ${author.orcid ? `<a href="https://orcid.org/${author.orcid}" target="_blank" class="text-xs text-blue-600 hover:underline">ORCID: ${author.orcid}</a>` : ''}
                </div>
            `).join('');
        };

        const renderPythonRequirements = (reqs) => {
            if (!reqs?.python_environment) return '<p class="text-sm text-gray-500">No Python requirements specified.</p>';
            const pyEnv = reqs.python_environment;
            const packages = pyEnv.packages?.map(pkg => `<li><code class="text-xs">${pkg.name}</code> ${pkg.version || ''}</li>`).join('') || '<li>No packages listed.</li>';
            return `
                <div class="text-sm">
                    <p class="mb-2"><strong>Python Version:</strong> <code class="bg-gray-100 p-1 rounded">${pyEnv.python_version || 'Not specified'}</code></p>
                    <strong class="block mb-1">Required Packages:</strong>
                    <ul class="list-disc list-inside space-y-1">${packages}</ul>
                </div>
            `;
        };
        
        const renderSources = (sources) => {
            if (!sources || Object.keys(sources).length === 0) return '<p class="text-sm text-gray-500">No sources provided.</p>';
            const sourceLinks = Object.entries(sources).map(([key, value]) => {
                if (!value) return null;
                const url = key === 'doi' || key === 'concept_doi' ? `https://doi.org/${value}` : value;
                return `<li><strong class="capitalize">${key.replace('_', ' ')}:</strong> <a href="${url}" target="_blank" class="text-blue-600 hover:underline break-all">${value}</a></li>`;
            }).filter(Boolean).join('');
            return `<ul class="space-y-1 text-sm">${sourceLinks}</ul>`;
        };
        
        const renderTags = (items, type) => {
            if (!items || items.length === 0) return '';
            return `
                <div class="info-section">
                    <h4 class="info-header capitalize">${type}</h4>
                    <div class="flex flex-wrap gap-2">
                        ${items.map(item => `<span class="tag-general">${item}</span>`).join('')}
                    </div>
                </div>
            `;
        };

        // --- Main Modal Body ---

        infoModalBody.innerHTML = `
            <div class="space-y-6">
                <div class="info-section">
                    <h4 class="info-header">Description</h4>
                    <p class="text-gray-600 leading-relaxed">${fullComponent.description || 'No description available.'}</p>
                </div>

                <div class="info-section">
                     <h4 class="info-header">Component Details</h4>
                     <div class="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 text-sm">
                        <div><strong class="text-gray-500">Name:</strong> <code class="bg-gray-100 p-1 rounded">${fullComponent.name}</code></div>
                        <div><strong class="text-gray-500">Category:</strong> ${fullComponent.category}</div>
                        <div><strong class="text-gray-500">Version:</strong> ${fullComponent.version}</div>
                        <div><strong class="text-gray-500">Status:</strong> <span class="capitalize font-medium">${fullComponent.status}</span></div>
                        ${fullComponent.license ? `<div><strong class="text-gray-500">License:</strong> <a href="${fullComponent.license.url || '#'}" target="_blank" class="text-blue-600 hover:underline">${fullComponent.license.type}</a></div>` : ''}
                        ${fullComponent.created ? `<div><strong class="text-gray-500">Created:</strong> ${new Date(fullComponent.created).toLocaleDateString()}</div>` : ''}
                        ${fullComponent.updated ? `<div><strong class="text-gray-500">Updated:</strong> ${new Date(fullComponent.updated).toLocaleDateString()}</div>` : ''}
                     </div>
                </div>
                
                <div class="info-section">
                    <h4 class="info-header">Sources & Links</h4>
                    ${renderSources(fullComponent.sources)}
                </div>

                <div class="info-section">
                    <h4 class="info-header">Authors</h4>
                    <div class="space-y-2">${renderAuthors(fullComponent.authors)}</div>
                </div>

                <div class="info-section">
                    <h4 class="info-header">Inputs (${(fullComponent.inputs || []).length})</h4>
                    ${(fullComponent.inputs || []).length > 0 ? 
                        `<div class="space-y-2">${fullComponent.inputs.map(input => `
                            <div class="info-card">
                                <div class="flex justify-between items-start">
                                    <div>
                                        <p class="font-semibold text-gray-800">${input.label || input.name}</p>
                                        <p class="text-xs text-gray-500 font-mono">${input.name}</p>
                                    </div>
                                    ${input.required ? '<span class="tag-required">Required</span>' : '<span class="tag-optional">Optional</span>'}
                                </div>
                                <p class="text-xs text-gray-600 mt-2">${input.description || ''}</p>
                                ${input.mutex_with ? `<p class="text-xs text-amber-700 mt-1"><strong>Mutually Exclusive with:</strong> ${input.mutex_with.join(', ')}</p>` : ''}
                            </div>`).join('')}
                        </div>` : 
                        '<p class="text-sm text-gray-500">No inputs defined.</p>'
                    }
                </div>

                <div class="info-section">
                     <h4 class="info-header">Outputs (${(fullComponent.outputs || []).length})</h4>
                     ${(fullComponent.outputs || []).length > 0 ? 
                        `<div class="space-y-2">${fullComponent.outputs.map(output => `
                            <div class="info-card bg-green-50 border-green-200">
                                <p class="font-semibold text-gray-800">${output.label || output.name}</p>
                                <p class="text-xs text-gray-500 font-mono">${output.name}</p>
                                <p class="text-xs text-gray-600 mt-2">${output.description || ''}</p>
                                <p class="text-xs text-gray-500 mt-2">Pattern: <code class="text-xs">${output.pattern || output.name}</code></p>
                            </div>`).join('')}
                        </div>` : 
                        '<p class="text-sm text-gray-500">No outputs defined.</p>'
                     }
                </div>

                <div class="info-section">
                    <h4 class="info-header">Python Requirements</h4>
                    ${renderPythonRequirements(fullComponent.requirements)}
                </div>
                
                ${renderTags(fullComponent.tags, 'tags')}
                ${renderTags(fullComponent.keywords, 'keywords')}
            </div>
        `;

    } catch (error) {
        console.error('Error rendering component info:', error);
        if (infoModalBody) {
            infoModalBody.innerHTML = `<p class="text-red-500">Error displaying component details: ${error.message}</p>`;
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

        // Always delegate to the componentInstallationManager to show the full installation modal.
        // This manager handles file requirements, log streaming, and the correct API endpoint.
        if (window.componentInstallationManager) {
            window.componentInstallationManager.showInstallModal(component);
        } else {
            console.error('CRITICAL: ComponentInstallationManager not found. The application state is inconsistent.');
            showToast('Error: Installation UI is unavailable. Please restart the application.', 'error');
        }

    } catch (error) {
        // This will catch any errors if showInstallModal itself fails.
        console.error('Error initiating component installation:', error);
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

async function checkForUpdates(isTestMode = false) {
    if (!updateCheckModal || !updateCheckModalBody) return;

    updateCheckModalBody.innerHTML = '<p class="text-center text-gray-500">Checking for updates...</p>';
    updateCheckModal.classList.remove('hidden');

    try {
        const apiUrl = isTestMode 
            ? `${COMPONENT_API_BASE}/check_updates?test_mode=true` 
            : `${COMPONENT_API_BASE}/check_updates`;
        const response = await fetch(apiUrl);
        const result = await response.json();

        if (!response.ok || !result.success) {
            throw new Error(result.error || 'Failed to check for updates.');
        }

        if (result.updates && result.updates.length > 0) {
            let tableHtml = `
                <p class="text-sm text-gray-600 mb-4">The following installed components have updates available:</p>
                <table class="w-full text-sm">
                    <thead class="bg-gray-50">
                        <tr>
                            <th class="p-2 text-left font-semibold">Component</th>
                            <th class="p-2 text-center font-semibold">Installed</th>
                            <th class="p-2 text-center font-semibold">Latest</th>
                            <th class="p-2 text-center font-semibold">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
            `;
            result.updates.forEach(update => {
                const zipUrl = update.file_links ? update.file_links['component_complete.zip'] : null;
                tableHtml += `
                    <tr class="border-b">
                        <td class="p-2">${update.label}</td>
                        <td class="p-2 text-center font-mono text-red-600">${update.local_version}</td>
                        <td class="p-2 text-center font-mono text-green-600">${update.remote_version}</td>
                        <td class="p-2 text-center space-x-2">
                            ${update.changelog_url 
                                ? `<button class="view-changelog-btn btn-secondary text-xs py-1 px-2" data-url="${update.changelog_url}" data-label="${update.label}">View Changelog</button>`
                                : ''
                            }
                            ${zipUrl
                                ? `<button class="update-component-btn btn-primary text-xs py-1 px-2" data-name="${update.name}" data-zip-url="${zipUrl}">Update</button>`
                                : `<span class="text-xs text-gray-400">Update N/A</span>`
                            }
                        </td>
                    </tr>
                `;
            });
            tableHtml += '</tbody></table>';
            updateCheckModalBody.innerHTML = tableHtml;
        } else {
            updateCheckModalBody.innerHTML = '<p class="text-center text-green-600 font-semibold">All your components are up to date! 🎉</p>';
        }

    } catch (error) {
        console.error("Error checking for component updates:", error);
        updateCheckModalBody.innerHTML = `<p class="text-red-500 text-center">Error: ${error.message}</p>`;
    }

    updateCheckModalBody.addEventListener('click', (e) => {
        const changelogBtn = e.target.closest('.view-changelog-btn');
        if (changelogBtn) {
            const url = changelogBtn.dataset.url;
            const label = changelogBtn.dataset.label;
            showChangelog(url, label);
            return;
        }

        const updateBtn = e.target.closest('.update-component-btn');
        if (updateBtn) {
            const componentName = updateBtn.dataset.name;
            const zipUrl = updateBtn.dataset.zipUrl;
            if (confirm(`Are you sure you want to update '${componentName}'?\n\nThis will overwrite the existing component files.`)) {
                updateComponent(componentName, zipUrl, updateBtn);
            }
        }
    });
}

async function updateComponent(componentName, zipUrl) {
    showToast(`Initiating update for ${componentName}...`, 'info');
    // Close the update check modal, as the installation modal will now take over.
    updateCheckModal.classList.add('hidden');
    
    // Show the installation modal in a "headless" state for the update
    const installManager = window.componentInstallationManager;
    installManager.showSimpleInstallModal(); // Use simple modal as no files are needed
    document.getElementById('installModalTitle').textContent = `Updating ${componentName}`;
    document.getElementById('componentInstallModal').classList.remove('hidden');
    installManager.setInstallationState(true); // Manually set to "installing" state
    installManager.updateInstallProgress(0, 'Starting update process...');

    try {
        const response = await fetch(`${COMPONENT_API_BASE}/${componentName}/update`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ zip_url: zipUrl })
        });

        const result = await response.json();

        if (!response.ok || !result.success) {
            throw new Error(result.error || 'Update failed to start on the server.');
        }

        // The backend returns an installation_id to enable stream logs (like a normal install)
        installManager.startLogStreaming(result.installation_id);

    } catch (error) {
        console.error(`Error updating component ${componentName}:`, error);
        showToast(`Update failed: ${error.message}`, 'error');
        // Use the installation manager to show the failure state
        installManager.addInstallLog('error', `❌ Failed to start update: ${error.message}`);
        installManager.setInstallationState(false, true); // Mark as complete with failure
    }
}

async function showChangelog(url, componentLabel) {
    if (!changelogModal || !changelogModalBody || !changelogModalTitle) {
        console.error("Changelog modal elements not found!");
        return;
    }

    changelogModalTitle.textContent = `Changelog for ${componentLabel}`;
    changelogModalBody.innerHTML = '<p class="text-center text-gray-500">Loading changelog...</p>';
    changelogModal.classList.remove('hidden');

    try {
        // Use the new backend proxy endpoint
        const response = await fetch(`${PYTHON_API_BASE_URL}/api/pipeline_components/changelog?url=${encodeURIComponent(url)}`);
        
        if (!response.ok) {
            const errorResult = await response.json();
            throw new Error(errorResult.error || 'Failed to fetch changelog content.');
        }

        const markdownContent = await response.text();

        const result = await window.electronAPI.markdownToHtml(markdownContent);
        
        if (result.success) {
            changelogModalBody.innerHTML = result.html;
        } else {
            throw new Error(result.error || 'Markdown conversion failed in the main process.');
        }

    } catch (error) {
        console.error("Error fetching or rendering changelog:", error);
        changelogModalBody.innerHTML = `<p class="text-red-500 text-center">Error: ${error.message}</p>`;
    }
}

async function showDownloadModal() {
    if (!downloadComponentsModal || !downloadableComponentsContainer) return;

    downloadableComponentsContainer.innerHTML = '<p class="text-center text-gray-500">Fetching available components...</p>';
    downloadComponentsModal.classList.remove('hidden');

    try {
        const response = await fetch(`${COMPONENT_API_BASE}/remote`);
        const result = await response.json();

        if (!response.ok || !result.success) {
            throw new Error(result.error || 'Failed to fetch component list.');
        }
        
        const categories = Object.keys(result.components).sort();
        
        if (categories.length === 0) {
            downloadableComponentsContainer.innerHTML = '<p class="text-center text-green-600 font-semibold">No new components available for download. Your local collection is complete!</p>';
            return;
        }

        let contentHtml = '';
        categories.forEach(category => {
            contentHtml += `<h3 class="text-lg font-semibold text-gray-700 pt-2 border-t first:pt-0 first:border-t-0">${category}</h3>`;
            result.components[category].forEach(component => {
                const zipUrl = component.file_links ? component.file_links['component_complete.zip'] : null;
                contentHtml += `
                    <div class="component-download-card">
                        <div>
                            <h4 class="font-bold">${component.label} <span class="text-xs font-mono text-gray-500">${component.version}</span></h4>
                            <p class="text-sm text-gray-600">${component.description}</p>
                        </div>
                        <div class="card-actions">
                            ${component.changelog_url ? `<button class="view-changelog-btn btn-secondary" data-url="${component.changelog_url}" data-label="${component.label}">View Changelog</button>` : ''}
                            ${zipUrl ? `<button class="download-component-btn btn-primary" data-name="${component.name}" data-zip-url="${zipUrl}" data-label="${component.label}">Download</button>` : ''}
                        </div>
                    </div>
                `;
            });
        });

        downloadableComponentsContainer.innerHTML = contentHtml;
        
        downloadableComponentsContainer.querySelectorAll('.download-component-btn').forEach(btn => {
            btn.addEventListener('click', handleComponentDownload);
        });
        downloadableComponentsContainer.querySelectorAll('.view-changelog-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const url = e.currentTarget.dataset.url;
                const label = e.currentTarget.dataset.label;
                showChangelog(url, label);
            });
        });

    } catch (error) {
        console.error("Error fetching downloadable components:", error);
        downloadableComponentsContainer.innerHTML = `<p class="text-red-500 text-center">Error: ${error.message}</p>`;
    }
}

async function handleComponentDownload(event) {
    const button = event.currentTarget;
    const componentName = button.dataset.name;
    const componentLabel = button.dataset.label;
    const zipUrl = button.dataset.zipUrl;

    const originalText = button.innerHTML;
    button.innerHTML = 'Downloading...';
    button.disabled = true;

    try {
        const response = await fetch(`${COMPONENT_API_BASE}/download`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ component_name: componentName, zip_url: zipUrl })
        });

        const result = await response.json();
        if (!response.ok || !result.success) {
            throw new Error(result.error || 'Download failed on the server.');
        }

        showToast(`'${componentLabel}' downloaded. Verifying...`, 'info');
        
        // Poll the backend to confirm the component is ready before refreshing the UI
        await waitForComponent(componentName);

        showToast(`'${componentLabel}' is ready!`, 'success');
        button.innerHTML = '✅ Downloaded';
        
        // Refresh components after confirmation
        await loadAndDisplayPipelineComponents();

        if (confirm(`Component '${componentLabel}' has been installed.\n\nDo you want to open the installation window now?`)) {
            downloadComponentsModal.classList.add('hidden');
            
            try {
                // Use the robust waitForElement function to find the install button after the UI has re-rendered
                const installButton = await waitForElement(`.component-card[data-component-name="${componentName}"] .install-btn`);
                installButton.click();
            } catch (error) {
                console.error(error);
                showToast("Could not automatically open installer. Please find the component in the list and click 'Install'.", "warning");
            }
        }

    } catch (error) {
        console.error(`Error downloading component ${componentName}:`, error);
        showToast(`Download failed: ${error.message}`, 'error');
        button.innerHTML = originalText;
        button.disabled = false;
    }
}


/**
 * Waits for a specified element to appear in the DOM.
 * @param {string} selector The CSS selector of the element to wait for.
 * @param {number} timeout The maximum time to wait in milliseconds.
 * @returns {Promise<Element>} A promise that resolves with the element when found.
 */
function waitForElement(selector, timeout = 5000) {
    return new Promise((resolve, reject) => {
        const intervalTime = 100;
        let elapsedTime = 0;
        const interval = setInterval(() => {
            const element = document.querySelector(selector);
            if (element) {
                clearInterval(interval);
                resolve(element);
            } else {
                elapsedTime += intervalTime;
                if (elapsedTime >= timeout) {
                    clearInterval(interval);
                    reject(new Error(`Element "${selector}" not found within ${timeout}ms.`));
                }
            }
        }, intervalTime);
    });
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
    if (closeUpdateCheckModalBtn) {
        closeUpdateCheckModalBtn.addEventListener('click', () => updateCheckModal.classList.add('hidden'));
    }
    if (closeUpdateCheckModalFooterBtn) {
        closeUpdateCheckModalFooterBtn.addEventListener('click', () => updateCheckModal.classList.add('hidden'));
    }
    if (closeChangelogBtn) {
        closeChangelogBtn.addEventListener('click', () => changelogModal.classList.add('hidden'));
    }
    if (closeChangelogFooterBtn) {
        closeChangelogFooterBtn.addEventListener('click', () => changelogModal.classList.add('hidden'));
    }
    if (closeDownloadComponentsBtn) {
        closeDownloadComponentsBtn.addEventListener('click', () => downloadComponentsModal.classList.add('hidden'));
    }
    if (closeDownloadComponentsFooterBtn) {
        closeDownloadComponentsFooterBtn.addEventListener('click', () => downloadComponentsModal.classList.add('hidden'));
    }
}

export function setInstallationStatus(status) {
    installationInProgress = status;
}