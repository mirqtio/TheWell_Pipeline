/**
 * Recommendation Components Index
 * Exports all recommendation-related UI components
 */

// Import components
import('./RecommendationWidget.js');
import('./PersonalizedDashboard.js');

// Import styles
const recommendationStyles = `
  <link rel="stylesheet" href="/components/recommendations/RecommendationWidget.css">
  <link rel="stylesheet" href="/components/recommendations/PersonalizedDashboard.css">
`;

// Insert styles into document head if not already present
if (!document.querySelector('link[href*="RecommendationWidget.css"]')) {
  document.head.insertAdjacentHTML('beforeend', recommendationStyles);
}

/**
 * Initialize recommendation components on the page
 */
function initializeRecommendations() {
  // Initialize recommendation widgets
  const widgetContainers = document.querySelectorAll('[data-recommendation-widget]');
  widgetContainers.forEach(container => {
    const options = {
      limit: parseInt(container.dataset.limit) || 5,
      category: container.dataset.category || null,
      showExplanation: container.dataset.showExplanation !== 'false',
      refreshInterval: parseInt(container.dataset.refreshInterval) || null
    };
    
    new window.RecommendationWidget(container, options);
  });
  
  // Initialize personalized dashboards
  const dashboardContainers = document.querySelectorAll('[data-personalized-dashboard]');
  dashboardContainers.forEach(container => {
    const options = {
      showRecommendations: container.dataset.showRecommendations !== 'false',
      showTrending: container.dataset.showTrending !== 'false',
      showCategories: container.dataset.showCategories !== 'false',
      showRecentActivity: container.dataset.showRecentActivity !== 'false'
    };
    
    new window.PersonalizedDashboard(container, options);
  });
}

// Auto-initialize on DOMContentLoaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeRecommendations);
} else {
  initializeRecommendations();
}

// Export for manual initialization
window.initializeRecommendations = initializeRecommendations;

// Export component classes
export { RecommendationWidget } from './RecommendationWidget.js';
export { PersonalizedDashboard } from './PersonalizedDashboard.js';