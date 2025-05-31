/**
 * TheWell Pipeline Manual Review Interface
 * Frontend JavaScript application for document review and job management
 */

class ManualReviewApp {
  constructor() {
    this.apiKey = localStorage.getItem('reviewApiKey') || 'dev-review-key';
    this.currentView = 'review';
    this.currentDocument = null;
    this.currentFilter = 'all';
    this.currentPage = 1;
    this.pageSize = 20;
    this.searchQuery = '';
    this.loadingStates = new Set();
    
    this.init();
  }

  /**
   * Initialize the application
   */
  async init() {
    this.setupEventListeners();
    this.setupAnimations();
    await this.loadUserInfo();
    await this.checkSystemStatus();
    await this.loadInitialData();
    
    // Set up periodic updates
    setInterval(() => this.updateSystemStatus(), 30000); // Every 30 seconds
    setInterval(() => this.refreshCurrentView(), 60000); // Every minute
  }

  /**
   * Setup animations and transitions
   */
  setupAnimations() {
    // Add intersection observer for fade-in animations
    const observerOptions = {
      threshold: 0.1,
      rootMargin: '0px 0px -50px 0px'
    };

    this.fadeInObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.style.opacity = '1';
          entry.target.style.transform = 'translateY(0)';
        }
      });
    }, observerOptions);

    // Setup reduced motion preferences
    this.prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /**
   * Setup event listeners
   */
  setupEventListeners() {
    // Navigation with smooth transitions
    document.querySelectorAll('[data-view]').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        this.switchViewWithAnimation(e.target.dataset.view);
      });
    });

    // Search with debouncing
    const searchInput = document.getElementById('search-input');
    let searchTimeout;
    searchInput.addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        this.searchQuery = e.target.value;
        this.searchDocuments();
      }, 300);
    });

    searchInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        clearTimeout(searchTimeout);
        this.searchDocuments();
      }
    });

    // Filter buttons with visual feedback
    document.querySelectorAll('[data-filter]').forEach(button => {
      button.addEventListener('click', (e) => {
        this.setFilterWithAnimation(e.target.dataset.filter);
      });
    });

    // Refresh buttons with loading animation
    document.querySelectorAll('[data-refresh]').forEach(button => {
      button.addEventListener('click', (e) => {
        this.refreshWithAnimation(e.target.dataset.refresh);
      });
    });

    // Setup touch gestures for mobile
    this.setupTouchGestures();
  }

  /**
   * Setup touch gestures for mobile interactions
   */
  setupTouchGestures() {
    let startY = 0;
    let currentY = 0;
    let pullDistance = 0;
    const pullThreshold = 100;

    document.addEventListener('touchstart', (e) => {
      startY = e.touches[0].clientY;
    });

    document.addEventListener('touchmove', (e) => {
      if (window.scrollY === 0) {
        currentY = e.touches[0].clientY;
        pullDistance = currentY - startY;
        
        if (pullDistance > 0 && pullDistance < pullThreshold * 2) {
          this.showPullToRefresh(pullDistance, pullThreshold);
        }
      }
    });

    document.addEventListener('touchend', () => {
      if (pullDistance > pullThreshold) {
        this.triggerPullToRefresh();
      } else {
        this.hidePullToRefresh();
      }
      pullDistance = 0;
    });
  }

  /**
   * Switch view with smooth animation
   */
  async switchViewWithAnimation(view) {
    if (this.currentView === view) return;

    // Add loading state
    this.setLoadingState('navigation', true);

    // Animate out current content
    const mainContent = document.querySelector('.main-content');
    if (!this.prefersReducedMotion) {
      mainContent.style.opacity = '0.5';
      mainContent.style.transform = 'translateY(10px)';
    }

    // Update navigation
    document.querySelectorAll('[data-view]').forEach(link => {
      link.classList.remove('active');
    });
    document.querySelector(`[data-view="${view}"]`).classList.add('active');

    // Switch view
    await this.switchView(view);

    // Animate in new content
    if (!this.prefersReducedMotion) {
      setTimeout(() => {
        mainContent.style.opacity = '1';
        mainContent.style.transform = 'translateY(0)';
      }, 150);
    }

    this.setLoadingState('navigation', false);
  }

  /**
   * Set filter with visual feedback
   */
  setFilterWithAnimation(filter) {
    // Update filter buttons
    document.querySelectorAll('[data-filter]').forEach(btn => {
      btn.classList.remove('active');
    });
    document.querySelector(`[data-filter="${filter}"]`).classList.add('active');

    // Animate filter change
    this.currentFilter = filter;
    this.currentPage = 1;
    this.loadReviewDataWithAnimation();
  }

  /**
   * Refresh with loading animation
   */
  async refreshWithAnimation(type) {
    const button = document.querySelector(`[data-refresh="${type}"]`);
    const icon = button.querySelector('i');
    
    // Add spinning animation
    icon.classList.add('spinning');
    button.disabled = true;

    try {
      switch (type) {
        case 'review':
          await this.refreshReviewData();
          break;
        case 'jobs':
          await this.refreshJobsData();
          break;
        case 'stats':
          await this.loadStatsData();
          break;
      }
    } finally {
      // Remove spinning animation
      setTimeout(() => {
        icon.classList.remove('spinning');
        button.disabled = false;
      }, 500);
    }
  }

  /**
   * Load review data with animation
   */
  async loadReviewDataWithAnimation() {
    this.setLoadingState('documents', true);
    this.showSkeletonLoading();

    try {
      await this.loadReviewData();
      this.hideSkeletonLoading();
      this.animateDocumentsIn();
    } catch (error) {
      this.hideSkeletonLoading();
      this.renderDocumentsError();
    } finally {
      this.setLoadingState('documents', false);
    }
  }

  /**
   * Show skeleton loading
   */
  showSkeletonLoading() {
    const container = document.getElementById('documents-container');
    const skeletonCount = 6;
    
    container.innerHTML = Array(skeletonCount).fill(0).map(() => `
      <div class="col-lg-6 col-xl-4">
        <div class="document-card skeleton-loading">
          <div class="card-header">
            <div class="skeleton-line" style="width: 70%;"></div>
            <div class="skeleton-line" style="width: 30%;"></div>
          </div>
          <div class="card-body">
            <div class="skeleton-line" style="width: 100%;"></div>
            <div class="skeleton-line" style="width: 85%;"></div>
            <div class="skeleton-line" style="width: 60%;"></div>
            <div class="d-flex justify-content-between mt-3">
              <div class="skeleton-line" style="width: 40%;"></div>
              <div class="skeleton-line" style="width: 25%;"></div>
            </div>
          </div>
        </div>
      </div>
    `).join('');
  }

  /**
   * Hide skeleton loading
   */
  hideSkeletonLoading() {
    const skeletons = document.querySelectorAll('.skeleton-loading');
    skeletons.forEach(skeleton => skeleton.remove());
  }

  /**
   * Animate documents in
   */
  animateDocumentsIn() {
    if (this.prefersReducedMotion) return;

    const cards = document.querySelectorAll('.document-card:not(.skeleton-loading)');
    cards.forEach((card, index) => {
      card.style.opacity = '0';
      card.style.transform = 'translateY(20px)';
      
      setTimeout(() => {
        card.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
        card.style.opacity = '1';
        card.style.transform = 'translateY(0)';
      }, index * 50);

      // Setup intersection observer for this card
      this.fadeInObserver.observe(card);
    });
  }

  /**
   * Show pull to refresh indicator
   */
  showPullToRefresh(distance, threshold) {
    let indicator = document.getElementById('pull-to-refresh');
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.id = 'pull-to-refresh';
      indicator.className = 'pull-to-refresh-indicator';
      indicator.innerHTML = '<i class="bi bi-arrow-down-circle"></i><span>Pull to refresh</span>';
      document.body.appendChild(indicator);
    }

    const progress = Math.min(distance / threshold, 1);
    indicator.style.opacity = progress;
    indicator.style.transform = `translateY(${Math.min(distance * 0.5, 50)}px)`;
    
    if (progress >= 1) {
      indicator.innerHTML = '<i class="bi bi-arrow-clockwise"></i><span>Release to refresh</span>';
    }
  }

  /**
   * Hide pull to refresh indicator
   */
  hidePullToRefresh() {
    const indicator = document.getElementById('pull-to-refresh');
    if (indicator) {
      indicator.style.opacity = '0';
      indicator.style.transform = 'translateY(-50px)';
      setTimeout(() => indicator.remove(), 300);
    }
  }

  /**
   * Trigger pull to refresh
   */
  async triggerPullToRefresh() {
    const indicator = document.getElementById('pull-to-refresh');
    if (indicator) {
      indicator.innerHTML = '<i class="bi bi-arrow-clockwise spinning"></i><span>Refreshing...</span>';
    }

    await this.refreshCurrentView();
    this.hidePullToRefresh();
    this.showToast('Refreshed', 'Content updated', 'success');
  }

  /**
   * Set loading state
   */
  setLoadingState(component, isLoading) {
    if (isLoading) {
      this.loadingStates.add(component);
    } else {
      this.loadingStates.delete(component);
    }

    // Update global loading indicator
    const globalLoader = document.getElementById('global-loader');
    if (globalLoader) {
      globalLoader.style.display = this.loadingStates.size > 0 ? 'block' : 'none';
    }
  }

  /**
   * Show toast notification with animation
   */
  showToast(title, message, type = 'info', duration = 3000) {
    const toast = document.createElement('div');
    toast.className = `toast-notification toast-${type}`;
    toast.innerHTML = `
      <div class="toast-content">
        <div class="toast-icon">
          <i class="bi bi-${this.getToastIcon(type)}"></i>
        </div>
        <div class="toast-text">
          <div class="toast-title">${title}</div>
          <div class="toast-message">${message}</div>
        </div>
        <button class="toast-close" onclick="this.parentElement.parentElement.remove()">
          <i class="bi bi-x"></i>
        </button>
      </div>
    `;

    // Add to container
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.className = 'toast-container';
      document.body.appendChild(container);
    }

    container.appendChild(toast);

    // Animate in
    if (!this.prefersReducedMotion) {
      toast.style.transform = 'translateX(100%)';
      setTimeout(() => {
        toast.style.transform = 'translateX(0)';
      }, 10);
    }

    // Auto remove
    setTimeout(() => {
      if (toast.parentElement) {
        if (!this.prefersReducedMotion) {
          toast.style.transform = 'translateX(100%)';
          setTimeout(() => toast.remove(), 300);
        } else {
          toast.remove();
        }
      }
    }, duration);
  }

  /**
   * Get toast icon based on type
   */
  getToastIcon(type) {
    const icons = {
      success: 'check-circle-fill',
      error: 'exclamation-triangle-fill',
      warning: 'exclamation-circle-fill',
      info: 'info-circle-fill'
    };
    return icons[type] || icons.info;
  }

  /**
   * Render documents with enhanced animations
   */
  renderDocuments(documents) {
    const container = document.getElementById('documents-container');
    
    if (documents.length === 0) {
      container.innerHTML = `
        <div class="col-12 text-center py-5 empty-state">
          <i class="bi bi-inbox fs-1 text-muted"></i>
          <h4 class="text-muted mt-3">No documents found</h4>
          <p class="text-muted">There are no documents pending review matching your criteria.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = documents.map(doc => `
      <div class="col-lg-6 col-xl-4">
        <div class="document-card ${this.getPriorityClass(doc.priority)} interactive-card" 
             data-document-id="${doc.id}"
             onclick="app.viewDocumentWithAnimation('${doc.id}')">
          <div class="card-header">
            <div class="d-flex justify-content-between align-items-start">
              <h6 class="document-title mb-0">${this.escapeHtml(doc.title)}</h6>
              <div class="d-flex gap-1">
                ${doc.flags.map(flag => `<span class="badge bg-warning">${flag.type}</span>`).join('')}
                ${doc.priority > 0 ? `<span class="badge bg-danger">Priority ${doc.priority}</span>` : ''}
              </div>
            </div>
          </div>
          <div class="card-body">
            <div class="document-preview">${this.escapeHtml(doc.contentPreview)}</div>
            <div class="document-meta">
              <span class="badge bg-secondary">${doc.source.type}</span>
              <span class="badge bg-info">${doc.metadata.fileType || 'unknown'}</span>
              ${doc.metadata.wordCount ? `<span class="badge bg-light text-dark">${doc.metadata.wordCount} words</span>` : ''}
              ${doc.assignedTo ? `<span class="badge bg-primary">Assigned: ${doc.assignedTo}</span>` : ''}
            </div>
            <div class="d-flex justify-content-between align-items-center mt-3">
              <small class="text-muted">
                <i class="bi bi-clock"></i> ${this.formatDate(doc.createdAt)}
              </small>
              <div class="document-actions">
                <button class="btn btn-sm btn-outline-primary action-btn" 
                        onclick="event.stopPropagation(); app.viewDocumentWithAnimation('${doc.id}')">
                  <i class="bi bi-eye"></i> Review
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `).join('');

    // Apply animations after render
    this.animateDocumentsIn();
  }

  /**
   * View document with animation
   */
  async viewDocumentWithAnimation(documentId) {
    const card = document.querySelector(`[data-document-id="${documentId}"]`);
    
    // Add loading state to card
    if (card && !this.prefersReducedMotion) {
      card.style.transform = 'scale(0.98)';
      card.style.opacity = '0.8';
    }

    try {
      await this.viewDocument(documentId);
    } finally {
      if (card && !this.prefersReducedMotion) {
        setTimeout(() => {
          card.style.transform = 'scale(1)';
          card.style.opacity = '1';
        }, 200);
      }
    }
  }

  /**
   * ========================================
   * VISIBILITY MANAGEMENT METHODS
   * ========================================
   */

  /**
   * Load visibility management data
   */
  async loadVisibilityData() {
    if (this.currentView !== 'visibility') return;

    try {
      await Promise.all([
        this.loadVisibilityDocuments(),
        this.loadPendingApprovals(),
        this.loadVisibilityRules(),
        this.loadAuditLog()
      ]);
    } catch (error) {
      console.error('Failed to load visibility data:', error);
      this.showToast('Failed to load visibility data', 'error');
    }
  }

  /**
   * Load documents with visibility information
   */
  async loadVisibilityDocuments() {
    const container = document.getElementById('visibility-documents-container');
    if (!container) return;

    try {
      this.setLoading('visibility-documents', true);
      
      // For now, we'll simulate getting documents from the review API
      // In a real implementation, this would be a dedicated visibility endpoint
      const response = await this.apiCall('/api/review/documents', {
        method: 'GET'
      });

      if (response.success && response.data) {
        this.renderVisibilityDocuments(response.data.documents || []);
      } else {
        throw new Error(response.error || 'Failed to load documents');
      }
    } catch (error) {
      console.error('Failed to load visibility documents:', error);
      container.innerHTML = `
        <div class="alert alert-danger">
          <i class="bi bi-exclamation-triangle"></i>
          Failed to load documents: ${error.message}
        </div>
      `;
    } finally {
      this.setLoading('visibility-documents', false);
    }
  }

  /**
   * Render documents with visibility controls
   */
  renderVisibilityDocuments(documents) {
    const container = document.getElementById('visibility-documents-container');
    if (!container) return;

    if (documents.length === 0) {
      container.innerHTML = `
        <div class="text-center py-4">
          <i class="bi bi-inbox" style="font-size: 3rem; color: #6c757d;"></i>
          <p class="mt-2 text-muted">No documents found</p>
        </div>
      `;
      return;
    }

    const documentsHtml = documents.map(doc => {
      const visibilityBadge = this.getVisibilityBadge(doc.visibility || 'internal');
      const lastModified = doc.lastModified ? new Date(doc.lastModified).toLocaleDateString() : 'Unknown';
      
      return `
        <div class="card mb-3 document-card" data-document-id="${doc.id}">
          <div class="card-body">
            <div class="row align-items-center">
              <div class="col-md-6">
                <h6 class="card-title mb-1">${this.escapeHtml(doc.title || doc.id)}</h6>
                <small class="text-muted">
                  <i class="bi bi-calendar"></i> ${lastModified}
                  <span class="ms-2">
                    <i class="bi bi-file-text"></i> ${doc.sourceType || 'Unknown'}
                  </span>
                </small>
              </div>
              <div class="col-md-3 text-center">
                ${visibilityBadge}
              </div>
              <div class="col-md-3 text-end">
                <div class="btn-group" role="group">
                  <button class="btn btn-outline-primary btn-sm" onclick="showDocumentVisibilityModal('${doc.id}', '${doc.visibility || 'internal'}')">
                    <i class="bi bi-pencil"></i> Change
                  </button>
                  <button class="btn btn-outline-info btn-sm" onclick="viewDocumentAudit('${doc.id}')">
                    <i class="bi bi-clock-history"></i> Audit
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      `;
    }).join('');

    container.innerHTML = documentsHtml;
  }

  /**
   * Get visibility badge HTML
   */
  getVisibilityBadge(visibility) {
    const badges = {
      'internal': '<span class="badge bg-primary">Internal</span>',
      'external': '<span class="badge bg-info">External</span>',
      'restricted': '<span class="badge bg-warning text-dark">Restricted</span>',
      'public': '<span class="badge bg-success">Public</span>',
      'draft': '<span class="badge bg-secondary">Draft</span>',
      'archived': '<span class="badge bg-dark">Archived</span>'
    };
    return badges[visibility] || '<span class="badge bg-light text-dark">Unknown</span>';
  }

  /**
   * Load pending approvals
   */
  async loadPendingApprovals() {
    const container = document.getElementById('pending-approvals-container');
    const countBadge = document.getElementById('pending-approvals-count');
    if (!container) return;

    try {
      this.setLoading('pending-approvals', true);
      
      const response = await this.apiCall('/api/visibility/approvals', {
        method: 'GET'
      });

      if (response.success && response.data) {
        const approvals = response.data;
        this.renderPendingApprovals(approvals);
        if (countBadge) {
          countBadge.textContent = approvals.length;
        }
      } else {
        throw new Error(response.error || 'Failed to load pending approvals');
      }
    } catch (error) {
      console.error('Failed to load pending approvals:', error);
      container.innerHTML = `
        <div class="alert alert-warning">
          <i class="bi bi-exclamation-triangle"></i>
          Visibility management may not be enabled or there was an error loading approvals.
        </div>
      `;
      if (countBadge) {
        countBadge.textContent = '0';
      }
    } finally {
      this.setLoading('pending-approvals', false);
    }
  }

  /**
   * Render pending approvals
   */
  renderPendingApprovals(approvals) {
    const container = document.getElementById('pending-approvals-container');
    if (!container) return;

    if (approvals.length === 0) {
      container.innerHTML = `
        <div class="text-center py-4">
          <i class="bi bi-check-circle" style="font-size: 3rem; color: #28a745;"></i>
          <p class="mt-2 text-muted">No pending approvals</p>
        </div>
      `;
      return;
    }

    const approvalsHtml = approvals.map(approval => {
      const requestedDate = new Date(approval.requestedAt).toLocaleDateString();
      const visibilityBadge = this.getVisibilityBadge(approval.requestedVisibility);
      
      return `
        <div class="card mb-3">
          <div class="card-body">
            <div class="row align-items-center">
              <div class="col-md-6">
                <h6 class="mb-1">Document: ${this.escapeHtml(approval.documentId)}</h6>
                <small class="text-muted">
                  Requested by: ${this.escapeHtml(approval.requestedBy)} on ${requestedDate}
                </small>
                ${approval.reason ? `<p class="mt-2 mb-0"><small><strong>Reason:</strong> ${this.escapeHtml(approval.reason)}</small></p>` : ''}
              </div>
              <div class="col-md-3 text-center">
                <div>Current: ${this.getVisibilityBadge(approval.currentVisibility)}</div>
                <div class="mt-1">Requested: ${visibilityBadge}</div>
              </div>
              <div class="col-md-3 text-end">
                <div class="btn-group" role="group">
                  <button class="btn btn-success btn-sm" onclick="approveVisibilityChange('${approval.id}')">
                    <i class="bi bi-check"></i> Approve
                  </button>
                  <button class="btn btn-danger btn-sm" onclick="rejectVisibilityChange('${approval.id}')">
                    <i class="bi bi-x"></i> Reject
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      `;
    }).join('');

    container.innerHTML = approvalsHtml;
  }

  /**
   * Load visibility rules
   */
  async loadVisibilityRules() {
    const container = document.getElementById('visibility-rules-container');
    if (!container) return;

    try {
      this.setLoading('visibility-rules', true);
      
      // For now, show a placeholder since rules are managed in the backend
      container.innerHTML = `
        <div class="alert alert-info">
          <i class="bi bi-info-circle"></i>
          Visibility rules are configured in the backend system. Use the "Add Rule" button to create new rules via the API.
        </div>
        <div class="text-center py-4">
          <i class="bi bi-gear" style="font-size: 3rem; color: #6c757d;"></i>
          <p class="mt-2 text-muted">Rules will be displayed here once the backend API is fully integrated</p>
        </div>
      `;
    } catch (error) {
      console.error('Failed to load visibility rules:', error);
      container.innerHTML = `
        <div class="alert alert-danger">
          <i class="bi bi-exclamation-triangle"></i>
          Failed to load visibility rules: ${error.message}
        </div>
      `;
    } finally {
      this.setLoading('visibility-rules', false);
    }
  }

  /**
   * Load audit log
   */
  async loadAuditLog() {
    const container = document.getElementById('audit-log-container');
    if (!container) return;

    try {
      this.setLoading('audit-log', true);
      
      // For now, show a placeholder
      container.innerHTML = `
        <div class="alert alert-info">
          <i class="bi bi-info-circle"></i>
          Audit log will show visibility changes once documents have visibility modifications.
        </div>
        <div class="text-center py-4">
          <i class="bi bi-clock-history" style="font-size: 3rem; color: #6c757d;"></i>
          <p class="mt-2 text-muted">No audit entries to display</p>
        </div>
      `;
    } catch (error) {
      console.error('Failed to load audit log:', error);
      container.innerHTML = `
        <div class="alert alert-danger">
          <i class="bi bi-exclamation-triangle"></i>
          Failed to load audit log: ${error.message}
        </div>
      `;
    } finally {
      this.setLoading('audit-log', false);
    }
  }

  /**
   * Set document visibility
   */
  async setDocumentVisibility(documentId, visibility, reason = '') {
    try {
      const response = await this.apiCall(`/api/visibility/document/${documentId}`, {
        method: 'PUT',
        body: JSON.stringify({
          visibility,
          reason,
          metadata: {
            changedVia: 'manual-review-ui',
            timestamp: new Date().toISOString()
          }
        })
      });

      if (response.success) {
        this.showToast('Document visibility updated successfully', 'success');
        await this.loadVisibilityData();
        return response.data;
      } else {
        throw new Error(response.error || 'Failed to update visibility');
      }
    } catch (error) {
      console.error('Failed to set document visibility:', error);
      this.showToast(`Failed to update visibility: ${error.message}`, 'error');
      throw error;
    }
  }

  /**
   * Bulk update document visibilities
   */
  async bulkUpdateVisibility(updates, reason = '') {
    try {
      const response = await this.apiCall('/api/visibility/bulk-update', {
        method: 'PUT',
        body: JSON.stringify({
          updates,
          reason
        })
      });

      if (response.success) {
        this.showToast(`Successfully updated ${updates.length} documents`, 'success');
        await this.loadVisibilityData();
        return response.data;
      } else {
        throw new Error(response.error || 'Failed to bulk update visibility');
      }
    } catch (error) {
      console.error('Failed to bulk update visibility:', error);
      this.showToast(`Failed to bulk update: ${error.message}`, 'error');
      throw error;
    }
  }

  /**
   * Approve visibility change
   */
  async approveVisibilityChange(approvalId, notes = '') {
    try {
      const response = await this.apiCall(`/api/visibility/approvals/${approvalId}/approve`, {
        method: 'POST',
        body: JSON.stringify({ notes })
      });

      if (response.success) {
        this.showToast('Visibility change approved', 'success');
        await this.loadPendingApprovals();
        return response.data;
      } else {
        throw new Error(response.error || 'Failed to approve visibility change');
      }
    } catch (error) {
      console.error('Failed to approve visibility change:', error);
      this.showToast(`Failed to approve: ${error.message}`, 'error');
      throw error;
    }
  }

  /**
   * Reject visibility change
   */
  async rejectVisibilityChange(approvalId, reason = '') {
    try {
      const response = await this.apiCall(`/api/visibility/approvals/${approvalId}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason })
      });

      if (response.success) {
        this.showToast('Visibility change rejected', 'warning');
        await this.loadPendingApprovals();
        return response.data;
      } else {
        throw new Error(response.error || 'Failed to reject visibility change');
      }
    } catch (error) {
      console.error('Failed to reject visibility change:', error);
      this.showToast(`Failed to reject: ${error.message}`, 'error');
      throw error;
    }
  }

  /**
   * Add visibility rule
   */
  async addVisibilityRule(ruleId, rule) {
    try {
      const response = await this.apiCall('/api/visibility/rules', {
        method: 'POST',
        body: JSON.stringify({ ruleId, rule })
      });

      if (response.success) {
        this.showToast('Visibility rule added successfully', 'success');
        await this.loadVisibilityRules();
        return response.data;
      } else {
        throw new Error(response.error || 'Failed to add visibility rule');
      }
    } catch (error) {
      console.error('Failed to add visibility rule:', error);
      this.showToast(`Failed to add rule: ${error.message}`, 'error');
      throw error;
    }
  }

  /**
   * Switch between different views
   */
  async switchView(view) {
    this.currentView = view;
    
    // Hide all views
    document.querySelectorAll('.view-content').forEach(el => {
      el.style.display = 'none';
    });
    
    // Show the selected view
    const targetView = document.getElementById(`${view}-view`);
    if (targetView) {
      targetView.style.display = 'block';
    }
    
    // Load data for the specific view
    switch (view) {
      case 'review':
        await this.loadReviewData();
        break;
      case 'jobs':
        await this.loadJobsData();
        break;
      case 'stats':
        await this.loadStatsData();
        break;
      case 'visibility':
        await this.loadVisibilityData();
        break;
      default:
        console.warn(`Unknown view: ${view}`);
    }
  }

  /**
   * Load initial application data
   */
  async loadInitialData() {
    // Load data for the default view (review)
    await this.switchView(this.currentView);
  }

  /**
   * Load user information
   */
  async loadUserInfo() {
    // Placeholder for user info loading
    // In a real implementation, this would fetch user details
    console.log('Loading user info...');
  }

  /**
   * Check system status
   */
  async checkSystemStatus() {
    // Placeholder for system status check
    // In a real implementation, this would check backend health
    console.log('Checking system status...');
  }

  /**
   * Update system status periodically
   */
  async updateSystemStatus() {
    // Placeholder for periodic status updates
    console.log('Updating system status...');
  }

  /**
   * Refresh current view data
   */
  async refreshCurrentView() {
    switch (this.currentView) {
      case 'review':
        await this.loadReviewData();
        break;
      case 'jobs':
        await this.loadJobsData();
        break;
      case 'stats':
        await this.loadStatsData();
        break;
      case 'visibility':
        await this.loadVisibilityData();
        break;
    }
  }

  /**
   * Show pull to refresh indicator
   */
  showPullToRefresh(distance, threshold) {
    let indicator = document.getElementById('pull-to-refresh');
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.id = 'pull-to-refresh';
      indicator.className = 'pull-to-refresh-indicator';
      indicator.innerHTML = '<i class="bi bi-arrow-down-circle"></i><span>Pull to refresh</span>';
      document.body.appendChild(indicator);
    }

    const progress = Math.min(distance / threshold, 1);
    indicator.style.opacity = progress;
    indicator.style.transform = `translateY(${Math.min(distance * 0.5, 50)}px)`;
    
    if (progress >= 1) {
      indicator.innerHTML = '<i class="bi bi-arrow-clockwise"></i><span>Release to refresh</span>';
    }
  }

  /**
   * Trigger pull to refresh action
   */
  async triggerPullToRefresh() {
    await this.refreshCurrentView();
    this.hidePullToRefresh();
  }

  /**
   * Hide pull to refresh indicator
   */
  hidePullToRefresh() {
    const indicator = document.getElementById('pull-to-refresh');
    if (indicator) {
      indicator.style.opacity = '0';
      indicator.style.transform = 'translateY(-50px)';
      setTimeout(() => indicator.remove(), 300);
    }
  }

  /**
   * ========================================
   * DATA LOADING METHODS (PLACEHOLDERS)
   * ========================================
   */

  /**
   * Load review data
   */
  async loadReviewData() {
    // Placeholder - this would be implemented in the full review system
    console.log('Loading review data...');
    const container = document.getElementById('documents-container');
    if (container) {
      container.innerHTML = `
        <div class="alert alert-info">
          <i class="bi bi-info-circle"></i>
          Review data loading will be implemented in the full review system.
        </div>
      `;
    }
  }

  /**
   * Load jobs data
   */
  async loadJobsData() {
    // Placeholder - this would be implemented in the full jobs system
    console.log('Loading jobs data...');
    const container = document.getElementById('jobs-container');
    if (container) {
      container.innerHTML = `
        <div class="alert alert-info">
          <i class="bi bi-info-circle"></i>
          Jobs data loading will be implemented in the full jobs system.
        </div>
      `;
    }
  }

  /**
   * Load stats data
   */
  async loadStatsData() {
    // Placeholder - this would be implemented in the full stats system
    console.log('Loading stats data...');
    const container = document.getElementById('stats-container');
    if (container) {
      container.innerHTML = `
        <div class="alert alert-info">
          <i class="bi bi-info-circle"></i>
          Stats data loading will be implemented in the full stats system.
        </div>
      `;
    }
  }

  /**
   * Refresh review data
   */
  async refreshReviewData() {
    await this.loadReviewData();
  }

  /**
   * Refresh jobs data
   */
  async refreshJobsData() {
    await this.loadJobsData();
  }

  /**
   * Search documents
   */
  async searchDocuments() {
    console.log(`Searching documents for: ${this.searchQuery}`);
    // Placeholder for search functionality
  }

  /**
   * Approve document
   */
  async approveDocument() {
    console.log('Approving document...');
    // Placeholder for document approval
  }

  /**
   * Reject document
   */
  async rejectDocument() {
    console.log('Rejecting document...');
    // Placeholder for document rejection
  }

  /**
   * Flag document
   */
  async flagDocument() {
    console.log('Flagging document...');
    // Placeholder for document flagging
  }

  /**
   * Set loading state
   */
  setLoading(component, isLoading) {
    this.setLoadingState(component, isLoading);
  }

  /**
   * Set loading state for components
   */
  setLoadingState(component, isLoading) {
    if (isLoading) {
      this.loadingStates.add(component);
    } else {
      this.loadingStates.delete(component);
    }
    
    // Update UI loading indicators
    const loadingElement = document.getElementById(`${component}-loading`);
    if (loadingElement) {
      loadingElement.style.display = isLoading ? 'block' : 'none';
    }
  }

  /**
   * Show toast notification
   */
  showToast(message, type = 'info') {
    // Create toast element
    const toast = document.createElement('div');
    toast.className = `toast align-items-center text-white bg-${type === 'error' ? 'danger' : type === 'warning' ? 'warning' : type === 'success' ? 'success' : 'primary'} border-0`;
    toast.setAttribute('role', 'alert');
    toast.innerHTML = `
      <div class="d-flex">
        <div class="toast-body">
          ${this.escapeHtml(message)}
        </div>
        <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
      </div>
    `;

    // Add to toast container
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.className = 'toast-container position-fixed top-0 end-0 p-3';
      container.style.zIndex = '1055';
      document.body.appendChild(container);
    }

    container.appendChild(toast);

    // Show toast
    const bsToast = new bootstrap.Toast(toast);
    bsToast.show();

    // Remove from DOM after hiding
    toast.addEventListener('hidden.bs.toast', () => {
      toast.remove();
    });
  }

  /**
   * Escape HTML to prevent XSS
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Make API call
   */
  async apiCall(url, options = {}) {
    const defaultOptions = {
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey
      }
    };

    const mergedOptions = {
      ...defaultOptions,
      ...options,
      headers: {
        ...defaultOptions.headers,
        ...options.headers
      }
    };

    try {
      const response = await fetch(url, mergedOptions);
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }
      
      return { success: true, data };
    } catch (error) {
      console.error(`API call failed: ${url}`, error);
      return { success: false, error: error.message };
    }
  }
}

// Global functions for onclick handlers
window.refreshReviewData = () => app.refreshReviewData();
window.refreshJobsData = () => app.refreshJobsData();
window.searchDocuments = () => app.searchDocuments();
window.approveDocument = () => app.approveDocument();
window.rejectDocument = () => app.rejectDocument();
window.flagDocument = () => app.flagDocument();

// Visibility management global functions
window.refreshVisibilityData = () => app.loadVisibilityData();
window.showBulkVisibilityModal = () => {
  const modal = new bootstrap.Modal(document.getElementById('bulkVisibilityModal'));
  modal.show();
};
window.showAddRuleModal = () => {
  const modal = new bootstrap.Modal(document.getElementById('addRuleModal'));
  modal.show();
};
window.showDocumentVisibilityModal = (documentId, currentVisibility) => {
  const modal = new bootstrap.Modal(document.getElementById('documentVisibilityModal'));
  document.getElementById('documentVisibilityDocumentId').value = documentId;
  document.getElementById('documentVisibilitySelect').value = currentVisibility;
  modal.show();
};
window.submitBulkVisibilityUpdate = async () => {
  const documentIds = document.getElementById('bulkDocumentIds').value.trim();
  const visibility = document.getElementById('bulkVisibilitySelect').value;
  const reason = document.getElementById('bulkVisibilityReason').value.trim();
  
  if (!documentIds || !visibility) {
    app.showToast('Please provide document IDs and select a visibility state', 'warning');
    return;
  }
  
  const ids = documentIds.split('\n').map(id => id.trim()).filter(id => id);
  const updates = ids.map(id => ({ documentId: id, visibility }));
  
  try {
    await app.bulkUpdateVisibility(updates, reason);
    bootstrap.Modal.getInstance(document.getElementById('bulkVisibilityModal')).hide();
    document.getElementById('bulkVisibilityForm').reset();
  } catch (error) {
    // Error already handled in the method
  }
};
window.submitAddRule = async () => {
  const ruleId = document.getElementById('ruleId').value.trim();
  const ruleName = document.getElementById('ruleName').value.trim();
  const ruleDescription = document.getElementById('ruleDescription').value.trim();
  const rulePriority = parseInt(document.getElementById('rulePriority').value);
  const ruleVisibility = document.getElementById('ruleVisibility').value;
  const ruleConditions = document.getElementById('ruleConditions').value.trim();
  
  if (!ruleId || !ruleName || !ruleVisibility) {
    app.showToast('Please fill in all required fields', 'warning');
    return;
  }
  
  let conditions;
  try {
    conditions = ruleConditions ? JSON.parse(ruleConditions) : {};
  } catch (error) {
    app.showToast('Invalid JSON in conditions field', 'error');
    return;
  }
  
  const rule = {
    name: ruleName,
    description: ruleDescription,
    priority: rulePriority,
    visibility: ruleVisibility,
    conditions
  };
  
  try {
    await app.addVisibilityRule(ruleId, rule);
    bootstrap.Modal.getInstance(document.getElementById('addRuleModal')).hide();
    document.getElementById('addRuleForm').reset();
  } catch (error) {
    // Error already handled in the method
  }
};
window.submitDocumentVisibilityChange = async () => {
  const documentId = document.getElementById('documentVisibilityDocumentId').value;
  const visibility = document.getElementById('documentVisibilitySelect').value;
  const reason = document.getElementById('documentVisibilityReason').value.trim();
  
  if (!documentId || !visibility) {
    app.showToast('Missing document ID or visibility state', 'warning');
    return;
  }
  
  try {
    await app.setDocumentVisibility(documentId, visibility, reason);
    bootstrap.Modal.getInstance(document.getElementById('documentVisibilityModal')).hide();
    document.getElementById('documentVisibilityForm').reset();
  } catch (error) {
    // Error already handled in the method
  }
};
window.approveVisibilityChange = async (approvalId) => {
  try {
    await app.approveVisibilityChange(approvalId);
  } catch (error) {
    // Error already handled in the method
  }
};
window.rejectVisibilityChange = async (approvalId) => {
  const reason = prompt('Please provide a reason for rejection (optional):');
  try {
    await app.rejectVisibilityChange(approvalId, reason || '');
  } catch (error) {
    // Error already handled in the method
  }
};
window.viewDocumentAudit = (documentId) => {
  // Switch to audit log tab and filter by document ID
  const auditTab = document.querySelector('a[href="#audit-log"]');
  if (auditTab) {
    auditTab.click();
    const searchInput = document.getElementById('auditDocumentSearch');
    if (searchInput) {
      searchInput.value = documentId;
      // Trigger search if implemented
    }
  }
};

// Initialize the application
const app = new ManualReviewApp();
