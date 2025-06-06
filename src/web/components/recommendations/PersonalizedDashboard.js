/**
 * PersonalizedDashboard Component
 * Shows personalized content dashboard with recommendations, trending items, and user preferences
 */

class PersonalizedDashboard {
  constructor(container, options = {}) {
    this.container = container;
    this.options = {
      showRecommendations: true,
      showTrending: true,
      showCategories: true,
      showRecentActivity: true,
      refreshInterval: 300000, // 5 minutes
      ...options
    };
    
    this.data = {
      recommendations: [],
      trending: [],
      categories: [],
      recentActivity: [],
      userProfile: null
    };
    
    this.widgets = {};
    this.refreshTimer = null;
    
    this.init();
  }

  async init() {
    this.render();
    await this.loadData();
    
    if (this.options.refreshInterval) {
      this.refreshTimer = setInterval(() => {
        this.refresh();
      }, this.options.refreshInterval);
    }
  }

  async loadData() {
    try {
      const promises = [];
      
      // Load user profile
      promises.push(this.loadUserProfile());
      
      // Load recommendations
      if (this.options.showRecommendations) {
        promises.push(this.loadRecommendations());
      }
      
      // Load trending
      if (this.options.showTrending) {
        promises.push(this.loadTrending());
      }
      
      // Load categories
      if (this.options.showCategories) {
        promises.push(this.loadCategories());
      }
      
      // Load recent activity
      if (this.options.showRecentActivity) {
        promises.push(this.loadRecentActivity());
      }
      
      await Promise.all(promises);
      this.render();
    } catch (error) {
      console.error('Error loading dashboard data:', error);
      this.renderError(error);
    }
  }

  async loadUserProfile() {
    const response = await fetch('/api/recommendations/profile', {
      headers: {
        'Authorization': `Bearer ${this.getAuthToken()}`
      }
    });
    
    if (response.ok) {
      const data = await response.json();
      this.data.userProfile = data.data;
    }
  }

  async loadRecommendations() {
    const response = await fetch('/api/recommendations?limit=10', {
      headers: {
        'Authorization': `Bearer ${this.getAuthToken()}`
      }
    });
    
    if (response.ok) {
      const data = await response.json();
      this.data.recommendations = data.data.recommendations;
    }
  }

  async loadTrending() {
    const response = await fetch('/api/recommendations/trending?limit=5', {
      headers: {
        'Authorization': `Bearer ${this.getAuthToken()}`
      }
    });
    
    if (response.ok) {
      const data = await response.json();
      this.data.trending = data.data.items;
    }
  }

  async loadCategories() {
    // This would load category data from an appropriate endpoint
    // For now, we'll extract from user profile interests
    if (this.data.userProfile?.preferences?.categories) {
      this.data.categories = this.data.userProfile.preferences.categories;
    }
  }

  async loadRecentActivity() {
    // This would load recent user activity
    // Placeholder for now
    this.data.recentActivity = [];
  }

  render() {
    const html = `
      <div class="personalized-dashboard">
        <div class="dashboard-header">
          <h1>Your Personalized Dashboard</h1>
          ${this.data.userProfile ? this.renderUserGreeting() : ''}
        </div>
        
        <div class="dashboard-grid">
          ${this.options.showRecommendations ? this.renderRecommendationsSection() : ''}
          ${this.options.showTrending ? this.renderTrendingSection() : ''}
          ${this.options.showCategories ? this.renderCategoriesSection() : ''}
          ${this.options.showRecentActivity ? this.renderRecentActivitySection() : ''}
        </div>
      </div>
    `;
    
    this.container.innerHTML = html;
    this.initializeWidgets();
  }

  renderUserGreeting() {
    const interests = this.data.userProfile.interests || [];
    return `
      <div class="user-greeting">
        <p>Welcome back! Based on your interests in 
          ${interests.slice(0, 3).map(i => `<span class="interest">${this.escapeHtml(i)}</span>`).join(', ')}
          ${interests.length > 3 ? ' and more' : ''},
          here's what we recommend for you.
        </p>
      </div>
    `;
  }

  renderRecommendationsSection() {
    return `
      <section class="dashboard-section recommendations-section">
        <div class="section-header">
          <h2>Recommended for You</h2>
          <a href="#" class="see-all-link" data-section="recommendations">See All</a>
        </div>
        <div class="recommendations-container">
          ${this.renderRecommendationCards()}
        </div>
      </section>
    `;
  }

  renderRecommendationCards() {
    if (!this.data.recommendations.length) {
      return '<p class="empty-message">No recommendations available yet. Keep exploring!</p>';
    }
    
    return `
      <div class="recommendation-cards">
        ${this.data.recommendations.slice(0, 6).map(item => `
          <div class="recommendation-card" data-id="${item.id}">
            <div class="card-header">
              ${item.category ? `<span class="card-category">${this.escapeHtml(item.category)}</span>` : ''}
              ${item.score ? `<span class="relevance-score" title="Relevance score">${Math.round(item.score * 100)}%</span>` : ''}
            </div>
            <h3 class="card-title">${this.escapeHtml(item.title || 'Untitled')}</h3>
            <p class="card-content">${this.escapeHtml(this.truncate(item.content || '', 150))}</p>
            ${item.explanation ? `<p class="card-explanation">${this.escapeHtml(item.explanation)}</p>` : ''}
            <div class="card-actions">
              <button class="card-action view-btn" data-id="${item.id}">View</button>
              <button class="card-action save-btn" data-id="${item.id}">Save</button>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  renderTrendingSection() {
    return `
      <section class="dashboard-section trending-section">
        <div class="section-header">
          <h2>Trending Now</h2>
          <select class="trending-filter" id="trending-timewindow">
            <option value="day">Today</option>
            <option value="week" selected>This Week</option>
            <option value="month">This Month</option>
          </select>
        </div>
        <div class="trending-container">
          ${this.renderTrendingList()}
        </div>
      </section>
    `;
  }

  renderTrendingList() {
    if (!this.data.trending.length) {
      return '<p class="empty-message">No trending items at the moment.</p>';
    }
    
    return `
      <ol class="trending-list">
        ${this.data.trending.map((item, index) => `
          <li class="trending-item" data-id="${item.id}">
            <span class="trending-rank">${index + 1}</span>
            <div class="trending-content">
              <h4 class="trending-title">${this.escapeHtml(item.title || 'Untitled')}</h4>
              <div class="trending-meta">
                ${item.category ? `<span class="trending-category">${this.escapeHtml(item.category)}</span>` : ''}
                <span class="trending-stats">${item.trendingScore} interactions</span>
              </div>
            </div>
          </li>
        `).join('')}
      </ol>
    `;
  }

  renderCategoriesSection() {
    if (!this.data.categories || !this.data.categories.length) {
      return '';
    }
    
    return `
      <section class="dashboard-section categories-section">
        <div class="section-header">
          <h2>Your Categories</h2>
          <a href="#" class="manage-link" data-action="manage-categories">Manage</a>
        </div>
        <div class="categories-container">
          <div class="category-chips">
            ${this.data.categories.map(cat => `
              <button class="category-chip" data-category="${cat.category}">
                <span class="chip-label">${this.escapeHtml(cat.category)}</span>
                <span class="chip-count">${cat.weight}</span>
              </button>
            `).join('')}
          </div>
        </div>
      </section>
    `;
  }

  renderRecentActivitySection() {
    return `
      <section class="dashboard-section activity-section">
        <div class="section-header">
          <h2>Recent Activity</h2>
          <a href="#" class="see-all-link" data-section="activity">View History</a>
        </div>
        <div class="activity-container">
          ${this.renderActivityList()}
        </div>
      </section>
    `;
  }

  renderActivityList() {
    if (!this.data.recentActivity.length) {
      return '<p class="empty-message">No recent activity to show.</p>';
    }
    
    // Placeholder for activity rendering
    return '<p class="empty-message">Activity tracking coming soon!</p>';
  }

  initializeWidgets() {
    // Attach event listeners
    this.attachEventListeners();
    
    // Initialize any sub-widgets if needed
    const recommendationsContainer = this.container.querySelector('.recommendations-container');
    if (recommendationsContainer && this.options.showRecommendations) {
      // Could initialize a more detailed widget here
    }
  }

  attachEventListeners() {
    // View buttons
    this.container.querySelectorAll('.view-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        this.handleViewItem(id);
      });
    });
    
    // Save buttons
    this.container.querySelectorAll('.save-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        this.handleSaveItem(id);
      });
    });
    
    // Recommendation cards
    this.container.querySelectorAll('.recommendation-card').forEach(card => {
      card.addEventListener('click', () => {
        const id = card.dataset.id;
        this.handleViewItem(id);
      });
    });
    
    // Trending items
    this.container.querySelectorAll('.trending-item').forEach(item => {
      item.addEventListener('click', () => {
        const id = item.dataset.id;
        this.handleViewItem(id);
      });
    });
    
    // Category chips
    this.container.querySelectorAll('.category-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const category = chip.dataset.category;
        this.handleCategoryClick(category);
      });
    });
    
    // Trending filter
    const trendingFilter = this.container.querySelector('#trending-timewindow');
    if (trendingFilter) {
      trendingFilter.addEventListener('change', (e) => {
        this.handleTrendingFilterChange(e.target.value);
      });
    }
    
    // See all links
    this.container.querySelectorAll('.see-all-link').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const section = link.dataset.section;
        this.handleSeeAll(section);
      });
    });
  }

  async handleViewItem(documentId) {
    // Record view interaction
    try {
      await fetch('/api/recommendations/interactions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.getAuthToken()}`
        },
        body: JSON.stringify({
          documentId,
          action: 'view',
          metadata: {
            source: 'personalized-dashboard'
          }
        })
      });
    } catch (error) {
      console.error('Error recording view:', error);
    }
    
    // Navigate to document or open in modal
    if (this.options.onViewItem) {
      this.options.onViewItem(documentId);
    } else {
      window.location.href = `/document/${documentId}`;
    }
  }

  async handleSaveItem(documentId) {
    const btn = this.container.querySelector(`.save-btn[data-id="${documentId}"]`);
    btn.classList.add('saving');
    btn.textContent = 'Saving...';
    
    try {
      await fetch('/api/recommendations/interactions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.getAuthToken()}`
        },
        body: JSON.stringify({
          documentId,
          action: 'save',
          metadata: {
            source: 'personalized-dashboard'
          }
        })
      });
      
      btn.classList.remove('saving');
      btn.classList.add('saved');
      btn.textContent = 'Saved';
      btn.disabled = true;
    } catch (error) {
      console.error('Error saving item:', error);
      btn.classList.remove('saving');
      btn.textContent = 'Save';
    }
  }

  handleCategoryClick(category) {
    if (this.options.onCategoryClick) {
      this.options.onCategoryClick(category);
    } else {
      // Navigate to category page
      window.location.href = `/category/${encodeURIComponent(category)}`;
    }
  }

  async handleTrendingFilterChange(timeWindow) {
    try {
      const response = await fetch(`/api/recommendations/trending?timeWindow=${timeWindow}&limit=5`, {
        headers: {
          'Authorization': `Bearer ${this.getAuthToken()}`
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        this.data.trending = data.data.items;
        
        // Re-render trending section
        const trendingContainer = this.container.querySelector('.trending-container');
        if (trendingContainer) {
          trendingContainer.innerHTML = this.renderTrendingList();
        }
      }
    } catch (error) {
      console.error('Error loading trending:', error);
    }
  }

  handleSeeAll(section) {
    if (this.options.onSeeAll) {
      this.options.onSeeAll(section);
    } else {
      // Navigate to full listing
      window.location.href = `/${section}`;
    }
  }

  renderError(error) {
    this.container.innerHTML = `
      <div class="dashboard-error">
        <h2>Unable to load dashboard</h2>
        <p>${error.message || 'An error occurred while loading your personalized dashboard.'}</p>
        <button onclick="location.reload()">Reload Page</button>
      </div>
    `;
  }

  refresh() {
    this.loadData();
  }

  destroy() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
    }
    this.container.innerHTML = '';
  }

  getAuthToken() {
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
window.PersonalizedDashboard = PersonalizedDashboard;