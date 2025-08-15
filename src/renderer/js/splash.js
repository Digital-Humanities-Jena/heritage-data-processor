// src/renderer/js/splash.js

// This function runs as soon as the splash screen's DOM is ready.
document.addEventListener('DOMContentLoaded', () => {
    // 1. Read the version number from the URL query parameter.
    const params = new URLSearchParams(window.location.search);
    const version = params.get('version');
    
    const versionElement = document.getElementById('version-info');
    if (versionElement && version) {
        versionElement.textContent = `Version ${version}`;
    }

    // 2. Listen for status update messages from the main process (main.js).
    // The 'electronAPI' is exposed via your preload.js script.
    if (window.electronAPI && window.electronAPI.onSplashStatusUpdate) {
        const statusElement = document.getElementById('status-message');
        
        window.electronAPI.onSplashStatusUpdate((message) => {
            if (statusElement) {
                // Update the text content with the message received from main.js
                statusElement.textContent = message;
            }
        });
    }
});