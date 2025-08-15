// src/renderer/js/core/navigation.js

import { isProjectLoaded } from './state.js';
import { showToast } from './ui.js';
import { refreshUploadsView } from '../views/uploads.js';
import { loadAndDisplayPipelineComponents } from '../views/pipelineComponents.js';

// --- DOM Elements ---
const navigationBackBtn = document.getElementById('navigationBackBtn');
const navigationForwardBtn = document.getElementById('navigationForwardBtn');
const sidebar = document.getElementById('sidebar');
const sidebarToggle = document.getElementById('sidebarToggle');
const desktopSidebarToggle = document.getElementById('desktopSidebarToggle');
const navLinks = document.querySelectorAll('.nav-link');
const viewSections = document.querySelectorAll('.view-section');

// --- Navigation History Class ---
class NavigationHistory {
    constructor() {
        this.history = [];
        this.currentIndex = -1;
        this.maxHistorySize = 50; // Prevent unlimited growth
    }

    // Add a new view to history (called during normal navigation)
    addToHistory(viewId) {
        // Don't add if it's the same as current view
        if (this.getCurrentView() === viewId) {
            return;
        }

        // Remove any forward history when navigating normally
        this.history = this.history.slice(0, this.currentIndex + 1);
        
        // Add new view
        this.history.push(viewId);
        this.currentIndex = this.history.length - 1;
        
        // Maintain max size
        if (this.history.length > this.maxHistorySize) {
            this.history.shift();
            this.currentIndex--;
        }
        
        this.updateButtonStates();
    }

    // Navigate back in history
    goBack() {
        if (this.canGoBack()) {
            this.currentIndex--;
            const viewId = this.history[this.currentIndex];
            this.navigateWithoutAddingToHistory(viewId);
            this.updateButtonStates();
            return viewId;
        }
        return null;
    }

    // Navigate forward in history
    goForward() {
        if (this.canGoForward()) {
            this.currentIndex++;
            const viewId = this.history[this.currentIndex];
            this.navigateWithoutAddingToHistory(viewId);
            this.updateButtonStates();
            return viewId;
        }
        return null;
    }

    // Check if we can go back
    canGoBack() {
        return this.currentIndex > 0;
    }

    // Check if we can go forward
    canGoForward() {
        return this.currentIndex < this.history.length - 1;
    }

    // Get current view
    getCurrentView() {
        return this.currentIndex >= 0 ? this.history[this.currentIndex] : null;
    }

    // Navigate without adding to history (for back/forward operations)
    navigateWithoutAddingToHistory(viewId) {
        navigateToViewInternal(viewId, false);
    }

    // Update button states
    updateButtonStates() {
        if (navigationBackBtn) {
            navigationBackBtn.disabled = !this.canGoBack();
            navigationBackBtn.classList.toggle('text-gray-400', !this.canGoBack());
            navigationBackBtn.classList.toggle('text-gray-600', this.canGoBack());
        }
        
        if (navigationForwardBtn) {
            navigationForwardBtn.disabled = !this.canGoForward();
            navigationForwardBtn.classList.toggle('text-gray-400', !this.canGoForward());
            navigationForwardBtn.classList.toggle('text-gray-600', this.canGoForward());
        }
    }

    // Get history info for debugging
    getHistoryInfo() {
        return {
            history: [...this.history],
            currentIndex: this.currentIndex,
            current: this.getCurrentView(),
            canGoBack: this.canGoBack(),
            canGoForward: this.canGoForward()
        };
    }
}

// --- Global Instance ---
const navigationHistory = new NavigationHistory();

// --- Core Functions ---

export function navigateToViewInternal(viewId, addToHistory = true) {
    const currentView = navigationHistory.getCurrentView();
    if (
        currentView === 'pipeline-constructor' &&
        viewId !== 'pipeline-constructor' &&
        window.pipelineConstructor?.currentPipeline?.isModified
    ) {
        if (!confirm('You have unsaved changes in the pipeline constructor. Are you sure you want to leave? Your changes will be lost.')) {
            return; // Stop the navigation if the user cancels
        }
    }
    
    console.log(`[Renderer] Navigating to view: ${viewId} (addToHistory: ${addToHistory})`);
    
    if (sidebar && desktopSidebarToggle) {
        // Hide sidebar for the constructor, show for all others
        if (viewId === 'pipeline-constructor') {
            sidebar.classList.add('collapsed');
            desktopSidebarToggle.classList.add('rotated');
        } else {
            sidebar.classList.remove('collapsed');
            desktopSidebarToggle.classList.remove('rotated');
        }
    }

    const hdpcIndependentViews = ['pipeline-components', 'pipeline-constructor'];
    const hdpcDependentViewsContainer = document.getElementById('hdpcContentsDisplay');
    const noFileLoadedContainer = document.getElementById('noFileLoaded');

    // First, hide all view sections and deactivate all nav links
    viewSections.forEach(section => {
        section.classList.remove('active');
    });
    navLinks.forEach(link => {
        link.classList.remove('active');
    });

    // Determine container visibility based on view type and project state
    if (hdpcIndependentViews.includes(viewId)) {
        // If it's an independent view, hide the dependent container and the "no file" prompt
        hdpcDependentViewsContainer.classList.add('hidden');
        noFileLoadedContainer.classList.add('hidden');
    } else {
        // If it's a dependent view, check if a project is loaded
        if (isProjectLoaded()) {
            hdpcDependentViewsContainer.classList.remove('hidden');
            noFileLoadedContainer.classList.add('hidden');
        } else {
            // No project loaded, so show the "no file" prompt and stop
            hdpcDependentViewsContainer.classList.add('hidden');
            noFileLoadedContainer.classList.remove('hidden');
            showToast("Please load an HDP project to access this view.", "warning");
            return;
        }
    }

    // Activate the target view section and nav link
    const targetView = document.getElementById(`view-${viewId}`);
    if (targetView) {
        targetView.classList.add('active');
    } else {
        console.error(`[Renderer] Target view with id 'view-${viewId}' NOT FOUND!`);
        return;
    }

    const targetLink = document.querySelector(`.nav-link[data-view="${viewId}"]`);
    if (targetLink) {
        targetLink.classList.add('active');
    }

    // Add to history if this is a normal navigation
    if (addToHistory) {
        navigationHistory.addToHistory(viewId);
    }

    // Trigger content loading and refreshes for specific views
    if (viewId === 'uploads') {
        refreshUploadsView();
    } else if (viewId === 'pipeline-components') {
        loadAndDisplayPipelineComponents();
    } else if (viewId === 'pipeline-constructor' && window.pipelineConstructor) {
        window.pipelineConstructor.initializeMainView();
    }

    // For mobile, collapse the sidebar after navigation
    if (window.innerWidth < 769 && sidebar) {
        const mobileToggle = document.getElementById('sidebarToggle');
        if(mobileToggle) {
             sidebar.classList.add('collapsed');
        }
    }
}

export function navigateToView(viewId) {
    navigateToViewInternal(viewId, true);
}

// --- Initialization ---
export function initNavigation() {
    // Sidebar Toggles
    if (sidebarToggle) {
        sidebarToggle.addEventListener('click', () => {
            sidebar?.classList.toggle('collapsed');
        });
    }
    if (desktopSidebarToggle) {
        desktopSidebarToggle.addEventListener('click', () => {
            sidebar?.classList.toggle('collapsed');
            desktopSidebarToggle.classList.toggle('rotated');
        });
    }

    // Main Navigation Links
    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const viewId = e.currentTarget.dataset.view;
            if (viewId) {
                navigateToView(viewId);
            }
        });
    });

    // Back/Forward History Buttons
    if (navigationBackBtn) {
        navigationBackBtn.addEventListener('click', (e) => {
            e.preventDefault();
            navigationHistory.goBack();
        });
    }
    if (navigationForwardBtn) {
        navigationForwardBtn.addEventListener('click', (e) => {
            e.preventDefault();
            navigationHistory.goForward();
        });
    }

    // Keyboard Shortcuts for Navigation
    document.addEventListener('keydown', (e) => {
        if ((e.altKey || e.metaKey) && e.key === 'ArrowLeft') {
            e.preventDefault();
            navigationHistory.goBack();
        } else if ((e.altKey || e.metaKey) && e.key === 'ArrowRight') {
            e.preventDefault();
            navigationHistory.goForward();
        }
    });

    // Set initial button states
    navigationHistory.updateButtonStates();
}