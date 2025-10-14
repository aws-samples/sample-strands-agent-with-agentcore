// Authentication status tracking
const authStatuses = {};

// Initialize page
document.addEventListener('DOMContentLoaded', function () {
    console.log('🚀 Chatbot embedding examples loaded');

    // Set up message listeners for each iframe
    setupMessageListeners();

    // Set up iframe load handlers
    setupIframeHandlers();

    // Initial auth check
    setTimeout(checkAllAuthStatus, 2000);
});

function setupMessageListeners() {
    window.addEventListener('message', function (event) {
        // In a real deployment, verify the origin
        // if (event.origin !== 'https://your-chatbot-domain.com') return;

        handleAuthMessage(event.data);
    });
}

function setupIframeHandlers() {
    const iframes = document.querySelectorAll('iframe');
    iframes.forEach((iframe, index) => {
        iframe.addEventListener('load', function () {
            console.log(`✅ Iframe ${iframe.id} loaded successfully`);
            updateStatus(iframe.id, 'checking', 'Iframe loaded, checking authentication...');
        });

        iframe.addEventListener('error', function () {
            console.error(`❌ Iframe ${iframe.id} failed to load`);
            updateStatus(iframe.id, 'error', 'Failed to load chatbot iframe');
        });
    });
}

function hideLoading(loadingId) {
    const loadingElement = document.getElementById(loadingId);
    if (loadingElement) {
        loadingElement.classList.add('hidden');
        setTimeout(() => {
            loadingElement.style.display = 'none';
        }, 300); // Wait for fade transition to complete
    }
}

function handleAuthMessage(data) {
    if (!data || !data.type) return;

    switch (data.type) {
        case 'CHATBOT_AUTH_STATUS':
            const { isAuthenticated, userId } = data.payload;
            const status = isAuthenticated ? 'authenticated' : 'unauthenticated';
            const message = isAuthenticated
                ? `✅ Authenticated as: ${userId}`
                : '🔒 Please log in to use the chatbot';

            // Update all status indicators
            updateAllStatuses(status, message);
            break;

        case 'CHATBOT_AUTH_ERROR':
            const errorMessage = `❌ Authentication error: ${data.payload.error}`;
            updateAllStatuses('error', errorMessage);
            break;

        case 'CHATBOT_READY':
            console.log('🎉 Chatbot is ready');
            break;

        default:
            console.log('📨 Received message:', data);
    }
}

function updateStatus(iframeId, status, message) {
    const statusElement = document.getElementById(getStatusId(iframeId));
    if (!statusElement) return;

    statusElement.className = `status-indicator status-${status}`;
    statusElement.innerHTML = message;

    authStatuses[iframeId] = { status, message };
}

function updateAllStatuses(status, message) {
    const statusElements = document.querySelectorAll('.status-indicator');
    statusElements.forEach(element => {
        element.className = `status-indicator status-${status}`;
        element.innerHTML = message;
    });
}

function getStatusId(iframeId) {
    const mapping = {
        'iframe1': 'status1',
        'iframe2': 'status2'
    };
    return mapping[iframeId] || 'status1';
}

function reloadIframe(iframeId) {
    const iframe = document.getElementById(iframeId);
    if (iframe) {
        updateStatus(iframeId, 'checking', '<span class="loading"></span> Reloading iframe...');
        iframe.src = iframe.src;
        console.log(`🔄 Reloading ${iframeId}`);
    }
}

function testAuth(iframeId) {
    const iframe = document.getElementById(iframeId);
    if (iframe && iframe.contentWindow) {
        try {
            // Send a test message to the iframe
            iframe.contentWindow.postMessage({ type: 'AUTH_STATUS_REQUEST' }, '*');
            updateStatus(iframeId, 'checking', '<span class="loading"></span> Testing authentication...');
            console.log(`🧪 Testing auth for ${iframeId}`);
        } catch (error) {
            console.error('Error testing auth:', error);
            updateStatus(iframeId, 'error', '❌ Could not test authentication');
        }
    }
}

function checkAllAuthStatus() {
    const iframes = document.querySelectorAll('iframe');
    iframes.forEach(iframe => {
        if (iframe.contentWindow) {
            try {
                iframe.contentWindow.postMessage({ type: 'AUTH_STATUS_REQUEST' }, '*');
            } catch (error) {
                console.log('Cross-origin restriction (expected):', error.message);
            }
        }
    });
}

// Floating widget functionality
function toggleWidget() {
    const widget = document.getElementById('floatingWidget');
    const chatbotIcon = document.getElementById('chatbotIcon');

    widget.classList.toggle('open');

    if (widget.classList.contains('open')) {
        // Slightly fade the chatbot icon when widget is open
        chatbotIcon.style.opacity = '0.7';
        chatbotIcon.style.transform = 'scale(0.9)';
    } else {
        // Show the chatbot icon normally when widget is closed
        chatbotIcon.style.opacity = '1';
        chatbotIcon.style.transform = 'scale(1)';
    }
}

// Close widget when clicking outside
document.addEventListener('click', function (event) {
    const widget = document.getElementById('floatingWidget');
    const chatbotIcon = document.getElementById('chatbotIcon');

    if (widget.classList.contains('open') &&
        !widget.contains(event.target) &&
        !chatbotIcon.contains(event.target)) {
        toggleWidget();
    }
});

// Keyboard shortcuts
document.addEventListener('keydown', function (event) {
    // Press 'C' to toggle floating widget
    if (event.key.toLowerCase() === 'c' && !event.ctrlKey && !event.metaKey) {
        const activeElement = document.activeElement;
        if (activeElement.tagName !== 'INPUT' && activeElement.tagName !== 'TEXTAREA') {
            toggleWidget();
        }
    }

    // Press 'R' to reload all iframes
    if (event.key.toLowerCase() === 'r' && event.ctrlKey) {
        event.preventDefault();
        const iframes = document.querySelectorAll('iframe');
        iframes.forEach(iframe => {
            iframe.src = iframe.src;
        });
        console.log('🔄 Reloading all iframes');
    }
});

// Performance monitoring
function monitorPerformance() {
    const observer = new PerformanceObserver((list) => {
        list.getEntries().forEach((entry) => {
            if (entry.name.includes('/embed')) {
                console.log(`📊 Embed page load time: ${entry.duration.toFixed(2)}ms`);
            }
        });
    });

    observer.observe({ entryTypes: ['navigation', 'resource'] });
}

// Start performance monitoring
if ('PerformanceObserver' in window) {
    monitorPerformance();
}

// Debug helpers
window.chatbotDebug = {
    reloadAll: () => {
        document.querySelectorAll('iframe').forEach(iframe => {
            iframe.src = iframe.src;
        });
    },
    getAuthStatuses: () => authStatuses,
    testMessage: (type, payload) => {
        handleAuthMessage({ type, payload });
    }
};

console.log('🛠️ Debug helpers available: window.chatbotDebug');