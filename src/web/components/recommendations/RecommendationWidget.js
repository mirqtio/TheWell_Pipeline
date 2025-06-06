/**
 * RecommendationWidget Component
 * Displays personalized recommendations for users
 */

class RecommendationWidget {
  constructor(container, options = {}) {
    this.container = container;
    this.options = {
      limit: 5,
      category: null,
      showExplanation: true,
      refreshInterval: null,
      onItemClick: null,
      onFeedback: null,
      ...options
    };
    
    this.recommendations = [];
    this.loading = false;
    this.error = null;
    this.refreshTimer = null;
    
    this.init();
  }

  init() {
    this.render();
    this.loadRecommendations();
    
    if (this.options.refreshInterval) {
      this.refreshTimer = setInterval(() => {
        this.loadRecommendations();
      }, this.options.refreshInterval);
    }
  }

  async loadRecommendations() {
    this.loading = true;
    this.error = null;
    this.renderLoading();

    try {
      const params = new URLSearchParams({
        limit: this.options.limit,
        includeExplanation: this.options.showExplanation
      });
      
      if (this.options.category) {
        params.append('category', this.options.category);
      }

      const response = await fetch(`/api/recommendations?${params}`, {
        headers: {
          'Authorization': `Bearer ${this.getAuthToken()}`
        }
      });

      if (!response.ok) {
        throw new Error('Failed to load recommendations');
      }

      const data = await response.json();
      this.recommendations = data.data.recommendations;
      this.loading = false;
      this.render();
    } catch (error) {
      console.error('Error loading recommendations:', error);
      this.error = error.message;
      this.loading = false;
      this.renderError();
    }
  }

  render() {
    if (this.loading) {
      this.renderLoading();
      return;
    }

    if (this.error) {
      this.renderError();
      return;
    }

    const html = `
      <div class="recommendation-widget">
        <div class="widget-header">
          <h3>Recommended for You</h3>
          <button class="refresh-btn" onclick="recommendationWidget.refresh()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M21.5 2v6h-6M2.5 22v-6h6M2 12c0-4.75 3.25-9 9-9s9 4 9 9M22 12c0 4.75-3.25 9-9 9s-9-4-9-9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        </div>
        <div class="recommendations-list">
          ${this.recommendations.length > 0 ? 
            this.recommendations.map((item, index) => this.renderRecommendation(item, index)).join('') :
            '<p class="no-recommendations">No recommendations available</p>'
          }
        </div>
      </div>
    `;

    this.container.innerHTML = html;
    this.attachEventListeners();
  }

  renderRecommendation(item, index) {
    return `
      <div class="recommendation-item" data-id="${item.id}" data-index="${index}">
        <div class="recommendation-content">
          <h4 class="recommendation-title">${this.escapeHtml(item.title || 'Untitled')}</h4>
          <p class="recommendation-snippet">${this.escapeHtml(this.truncate(item.content || '', 100))}</p>
          ${item.category ? `<span class="recommendation-category">${this.escapeHtml(item.category)}</span>` : ''}
          ${this.options.showExplanation && item.explanation ? 
            `<p class="recommendation-explanation">${this.escapeHtml(item.explanation)}</p>` : ''
          }
        </div>
        <div class="recommendation-actions">
          <button class="action-btn like-btn" data-action="like" title="Like">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
          <button class="action-btn dislike-btn" data-action="dislike" title="Not interested">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        </div>
      </div>
    `;
  }

  renderLoading() {
    this.container.innerHTML = `
      <div class="recommendation-widget loading">
        <div class="widget-header">
          <h3>Recommended for You</h3>
        </div>
        <div class="loading-spinner">
          <div class="spinner"></div>
          <p>Loading recommendations...</p>
        </div>
      </div>
    `;
  }

  renderError() {
    this.container.innerHTML = `
      <div class="recommendation-widget error">
        <div class="widget-header">
          <h3>Recommended for You</h3>
        </div>
        <div class="error-message">
          <p>Unable to load recommendations</p>
          <button class="retry-btn" onclick="recommendationWidget.refresh()">Try Again</button>
        </div>
      </div>
    `;
  }

  attachEventListeners() {
    // Click on recommendation items
    const items = this.container.querySelectorAll('.recommendation-item');
    items.forEach(item => {
      item.addEventListener('click', (e) => {
        if (!e.target.closest('.recommendation-actions')) {
          const id = item.dataset.id;
          const index = parseInt(item.dataset.index);
          this.handleItemClick(id, index);
        }
      });
    });

    // Feedback buttons
    const feedbackBtns = this.container.querySelectorAll('.action-btn');
    feedbackBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const item = btn.closest('.recommendation-item');
        const id = item.dataset.id;
        const index = parseInt(item.dataset.index);
        const action = btn.dataset.action;
        this.handleFeedback(id, index, action);
      });
    });
  }

  async handleItemClick(documentId, index) {
    // Record click interaction
    try {
      await fetch('/api/recommendations/interactions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.getAuthToken()}`
        },
        body: JSON.stringify({
          documentId,
          action: 'click',
          metadata: {
            position: index,
            widget: 'recommendation-widget'
          }
        })
      });
    } catch (error) {
      console.error('Error recording interaction:', error);
    }

    // Call custom handler if provided
    if (this.options.onItemClick) {
      this.options.onItemClick(documentId, this.recommendations[index]);
    }
  }

  async handleFeedback(documentId, index, feedback) {
    const recommendation = this.recommendations[index];
    
    // Visual feedback
    const item = this.container.querySelector(`[data-id="${documentId}"]`);
    item.classList.add('feedback-given', `feedback-${feedback}`);

    try {
      // Record feedback
      await fetch('/api/recommendations/feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.getAuthToken()}`
        },
        body: JSON.stringify({
          documentId,
          feedback: feedback === 'like' ? 'positive' : 'negative',
          algorithm: recommendation.algorithm,
          position: index,
          metadata: {
            widget: 'recommendation-widget'
          }
        })
      });

      // Remove item if disliked
      if (feedback === 'dislike') {
        setTimeout(() => {
          item.style.opacity = '0';
          setTimeout(() => {
            item.remove();
            // Load one more recommendation if needed
            if (this.container.querySelectorAll('.recommendation-item').length < this.options.limit) {
              this.loadMoreRecommendations(1);
            }
          }, 300);
        }, 500);
      }
    } catch (error) {
      console.error('Error recording feedback:', error);
    }

    // Call custom handler if provided
    if (this.options.onFeedback) {
      this.options.onFeedback(documentId, feedback, recommendation);
    }
  }

  async loadMoreRecommendations(count) {
    // This would load additional recommendations to fill the widget
    // For now, we'll just refresh the whole list
    await this.loadRecommendations();
  }

  refresh() {
    this.loadRecommendations();
  }

  destroy() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
    }
    this.container.innerHTML = '';
  }

  getAuthToken() {
    // Get auth token from wherever it's stored (localStorage, cookie, etc.)
    return localStorage.getItem('authToken') || '';
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  truncate(text, length) {
    if (text.length <= length) return text;
    return text.substring(0, length) + '...';
  }
}

// Make it globally available
window.RecommendationWidget = RecommendationWidget;