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
    this.selectedItems = new Set();
    this.draggedItem = null;
    this.curationData = {
      pending: [],
      'in-review': [],
      processed: []
    };
    
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
    case 'curation':
      await this.loadCurationData();
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
    case 'curation':
      await this.loadCurationData();
      break;
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

  /**
   * Load curation data for Kanban board
   */
  async loadCurationData() {
    try {
      this.setLoadingState('curation', true);
      
      const response = await fetch('/api/v1/review/pending?limit=100', {
        headers: {
          'x-api-key': this.apiKey,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to load curation data: ${response.statusText}`);
      }

      const data = await response.json();
      
      // Organize data by status for Kanban columns
      this.curationData = {
        pending: data.documents?.filter(doc => doc.status === 'pending' || !doc.status) || [],
        'in-review': data.documents?.filter(doc => doc.status === 'in-review') || [],
        processed: data.documents?.filter(doc => doc.status === 'approved' || doc.status === 'rejected') || []
      };

      this.renderKanbanBoard();
      this.updateKanbanCounts();
      
    } catch (error) {
      console.error('Error loading curation data:', error);
      this.showErrorMessage('Failed to load curation data');
    } finally {
      this.setLoadingState('curation', false);
    }
  }

  /**
   * Render the Kanban board with current data
   */
  renderKanbanBoard() {
    const columns = ['pending', 'in-review', 'processed'];
    
    columns.forEach(status => {
      const column = document.getElementById(`${status === 'in-review' ? 'in-review' : status}-column`);
      if (!column) return;

      const items = this.curationData[status] || [];
      
      if (items.length === 0) {
        column.innerHTML = this.getEmptyColumnHTML(status);
      } else {
        column.innerHTML = items.map(item => this.createKanbanCard(item, status)).join('');
      }

      // Setup drag and drop for this column
      this.setupDragAndDrop(column, status);
    });
  }

  /**
   * Create a Kanban card HTML
   */
  createKanbanCard(item, status) {
    const priority = this.getPriority(item);
    const reliability = this.getSourceReliability(item);
    const timeAgo = this.formatTimeAgo(item.createdAt);
    
    return `
      <div class="kanban-card ${priority}" 
           draggable="true" 
           data-item-id="${item.id}"
           data-status="${status}">
        <div class="form-check position-absolute top-0 end-0 m-2">
          <input class="form-check-input" type="checkbox" 
                 onchange="app.toggleItemSelection('${item.id}')" 
                 id="select-${item.id}">
        </div>
        
        <div class="kanban-card-header">
          <div class="kanban-card-title">${this.truncateText(item.title || 'Untitled Document', 60)}</div>
        </div>
        
        <div class="kanban-card-meta">
          <span class="badge bg-secondary">${item.source?.type || 'Unknown'}</span>
          <span class="badge bg-info reliability-${reliability}">${item.source?.name || 'Unknown Source'}</span>
          ${item.flags?.length ? `<span class="badge bg-warning">🚩 ${item.flags.length}</span>` : ''}
        </div>
        
        <div class="kanban-card-content">
          ${this.truncateText(item.contentPreview || item.content || 'No content preview available', 150)}
        </div>
        
        <div class="kanban-card-footer">
          <small class="text-muted">
            <i class="bi bi-clock"></i> ${timeAgo}
          </small>
          <div class="kanban-card-actions">
            ${this.getCardActions(item, status)}
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Get card actions based on status
   */
  getCardActions(item, status) {
    switch (status) {
    case 'pending':
      return `
          <button class="btn btn-sm btn-outline-primary" onclick="app.startReview('${item.id}')">
            <i class="bi bi-eye"></i>
          </button>
          <button class="btn btn-sm btn-outline-success" onclick="app.quickApprove('${item.id}')">
            <i class="bi bi-check"></i>
          </button>
          <button class="btn btn-sm btn-outline-danger" onclick="app.quickReject('${item.id}')">
            <i class="bi bi-x"></i>
          </button>
        `;
    case 'in-review':
      return `
          <button class="btn btn-primary btn-sm" onclick="app.openReviewModal('${item.id}')">
            <i class="bi bi-pencil"></i> Review
          </button>
        `;
    case 'processed':
      return `
          <button class="btn btn-sm btn-outline-info" onclick="app.viewProcessedItem('${item.id}')">
            <i class="bi bi-info-circle"></i>
          </button>
        `;
    default:
      return '';
    }
  }

  /**
   * Setup drag and drop functionality
   */
  setupDragAndDrop(column, status) {
    // Setup drag events for cards
    const cards = column.querySelectorAll('.kanban-card');
    cards.forEach(card => {
      card.addEventListener('dragstart', (e) => {
        this.draggedItem = {
          id: card.dataset.itemId,
          fromStatus: card.dataset.status,
          element: card
        };
        card.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      });

      card.addEventListener('dragend', () => {
        card.classList.remove('dragging');
        this.draggedItem = null;
      });
    });

    // Setup drop events for column
    column.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      column.classList.add('drag-over');
    });

    column.addEventListener('dragleave', () => {
      column.classList.remove('drag-over');
    });

    column.addEventListener('drop', (e) => {
      e.preventDefault();
      column.classList.remove('drag-over');
      
      if (this.draggedItem && this.draggedItem.fromStatus !== status) {
        this.moveItem(this.draggedItem.id, this.draggedItem.fromStatus, status);
      }
    });
  }

  /**
   * Move item between columns
   */
  async moveItem(itemId, fromStatus, toStatus) {
    try {
      // Optimistically update UI
      const item = this.findItemById(itemId);
      if (!item) return;

      // Remove from old column
      this.curationData[fromStatus] = this.curationData[fromStatus].filter(i => i.id !== itemId);
      
      // Add to new column
      item.status = toStatus;
      this.curationData[toStatus].push(item);
      
      // Re-render affected columns
      this.renderKanbanBoard();
      this.updateKanbanCounts();

      // Make API call to update status
      const endpoint = this.getStatusUpdateEndpoint(toStatus);
      if (endpoint) {
        const response = await fetch(endpoint.replace(':id', itemId), {
          method: 'POST',
          headers: {
            'x-api-key': this.apiKey,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            notes: `Moved to ${toStatus} via drag and drop`,
            timestamp: new Date().toISOString()
          })
        });

        if (!response.ok) {
          throw new Error(`Failed to update item status: ${response.statusText}`);
        }
      }

      this.showSuccessMessage(`Item moved to ${toStatus.replace('-', ' ')}`);
      
    } catch (error) {
      console.error('Error moving item:', error);
      this.showErrorMessage('Failed to move item');
      // Reload data to restore correct state
      await this.loadCurationData();
    }
  }

  /**
   * Get status update endpoint
   */
  getStatusUpdateEndpoint(status) {
    switch (status) {
    case 'in-review':
      return '/api/v1/review/start-review/:id';
    case 'processed':
      return '/api/v1/review/approve/:id';
    default:
      return null;
    }
  }

  /**
   * Update Kanban column counts
   */
  updateKanbanCounts() {
    const counts = {
      'pending-kanban-count': this.curationData.pending?.length || 0,
      'in-review-kanban-count': this.curationData['in-review']?.length || 0,
      'processed-kanban-count': this.curationData.processed?.length || 0
    };

    Object.entries(counts).forEach(([id, count]) => {
      const element = document.getElementById(id);
      if (element) {
        element.textContent = count;
      }
    });
  }

  /**
   * Toggle item selection for bulk operations
   */
  toggleItemSelection(itemId) {
    if (this.selectedItems.has(itemId)) {
      this.selectedItems.delete(itemId);
    } else {
      this.selectedItems.add(itemId);
    }

    // Update UI
    const card = document.querySelector(`[data-item-id="${itemId}"]`);
    if (card) {
      card.classList.toggle('selected', this.selectedItems.has(itemId));
    }

    // Show/hide bulk operations bar
    this.updateBulkOperationsBar();
  }

  /**
   * Update bulk operations bar visibility
   */
  updateBulkOperationsBar() {
    const bar = document.getElementById('bulk-operations-bar');
    const count = this.selectedItems.size;
    
    if (count > 0) {
      if (!bar) {
        this.createBulkOperationsBar();
      } else {
        bar.classList.add('show');
        const countElement = bar.querySelector('.selected-count');
        if (countElement) {
          countElement.textContent = count;
        }
      }
    } else if (bar) {
      bar.classList.remove('show');
    }
  }

  /**
   * Create bulk operations bar
   */
  createBulkOperationsBar() {
    const bar = document.createElement('div');
    bar.id = 'bulk-operations-bar';
    bar.className = 'bulk-operations-bar show';
    bar.innerHTML = `
      <div class="bulk-operations-content">
        <div>
          <span class="selected-count">${this.selectedItems.size}</span> items selected
        </div>
        <div class="d-flex gap-2 flex-wrap">
          <button class="btn btn-success btn-sm" onclick="app.bulkApprove()">
            <i class="bi bi-check-all"></i> Approve All
          </button>
          <button class="btn btn-danger btn-sm" onclick="app.bulkReject()">
            <i class="bi bi-x-circle"></i> Reject All
          </button>
          <button class="btn btn-warning btn-sm" onclick="app.bulkStartReview()">
            <i class="bi bi-eye"></i> Start Review
          </button>
          <button class="btn btn-info btn-sm" onclick="app.bulkFlag()">
            <i class="bi bi-flag"></i> Flag
          </button>
          <button class="btn btn-primary btn-sm" onclick="app.bulkAssign()">
            <i class="bi bi-person-check"></i> Assign
          </button>
          <button class="btn btn-outline-primary btn-sm" onclick="app.bulkAddTags()">
            <i class="bi bi-tags"></i> Add Tags
          </button>
          <button class="btn btn-outline-secondary btn-sm" onclick="app.bulkRemoveTags()">
            <i class="bi bi-tag"></i> Remove Tags
          </button>
          <button class="btn btn-secondary btn-sm" onclick="app.clearSelection()">
            <i class="bi bi-x"></i> Clear
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(bar);
  }

  /**
   * Bulk approve selected items
   */
  async bulkApprove() {
    if (this.selectedItems.size === 0) return;

    try {
      const promises = Array.from(this.selectedItems).map(itemId => 
        this.approveItem(itemId, 'Bulk approved')
      );
      
      await Promise.all(promises);
      this.showSuccessMessage(`${this.selectedItems.size} items approved`);
      this.clearSelection();
      await this.loadCurationData();
      
    } catch (error) {
      console.error('Error in bulk approve:', error);
      this.showErrorMessage('Failed to approve some items');
    }
  }

  /**
   * Bulk reject selected items
   */
  async bulkReject() {
    if (this.selectedItems.size === 0) return;

    const reason = prompt('Enter rejection reason:');
    if (!reason) return;

    try {
      const promises = Array.from(this.selectedItems).map(itemId => 
        this.rejectItem(itemId, reason)
      );
      
      await Promise.all(promises);
      this.showSuccessMessage(`${this.selectedItems.size} items rejected`);
      this.clearSelection();
      await this.loadCurationData();
      
    } catch (error) {
      console.error('Error in bulk reject:', error);
      this.showErrorMessage('Failed to reject some items');
    }
  }

  /**
   * Clear selection
   */
  clearSelection() {
    this.selectedItems.clear();
    document.querySelectorAll('.kanban-card.selected').forEach(card => {
      card.classList.remove('selected');
      const checkbox = card.querySelector('.form-check-input');
      if (checkbox) checkbox.checked = false;
    });
    this.updateBulkOperationsBar();
  }

  /**
   * Quick approve item
   */
  async quickApprove(itemId) {
    try {
      await this.approveItem(itemId, 'Quick approved');
      this.showSuccessMessage('Item approved');
      await this.loadCurationData();
    } catch (error) {
      console.error('Error approving item:', error);
      this.showErrorMessage('Failed to approve item');
    }
  }

  /**
   * Quick reject item
   */
  async quickReject(itemId) {
    const reason = prompt('Enter rejection reason:');
    if (!reason) return;

    try {
      await this.rejectItem(itemId, reason);
      this.showSuccessMessage('Item rejected');
      await this.loadCurationData();
    } catch (error) {
      console.error('Error rejecting item:', error);
      this.showErrorMessage('Failed to reject item');
    }
  }

  /**
   * Approve item via API
   */
  async approveItem(itemId, notes = '') {
    const response = await fetch(`/api/v1/review/approve/${itemId}`, {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        notes,
        visibility: 'internal',
        tags: []
      })
    });

    if (!response.ok) {
      throw new Error(`Failed to approve item: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Reject item via API
   */
  async rejectItem(itemId, reason, notes = '') {
    const response = await fetch(`/api/v1/review/reject/${itemId}`, {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        reason,
        notes,
        permanent: false
      })
    });

    if (!response.ok) {
      throw new Error(`Failed to reject item: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Bulk flag selected items
   */
  async bulkFlag() {
    if (this.selectedItems.size === 0) return;

    // Show modal to get flag details
    const modal = document.createElement('div');
    modal.className = 'modal fade';
    modal.innerHTML = `
      <div class="modal-dialog">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">Bulk Flag Documents</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body">
            <form id="bulkFlagForm">
              <div class="mb-3">
                <label for="flagType" class="form-label">Flag Type *</label>
                <select class="form-select" id="flagType" required>
                  <option value="">Select flag type...</option>
                  <option value="quality">Quality Issue</option>
                  <option value="content">Content Issue</option>
                  <option value="duplicate">Duplicate</option>
                  <option value="spam">Spam</option>
                  <option value="inappropriate">Inappropriate</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div class="mb-3">
                <label for="flagReason" class="form-label">Reason</label>
                <textarea class="form-control" id="flagReason" rows="3" placeholder="Optional reason for flagging..."></textarea>
              </div>
              <div class="mb-3">
                <label for="flagPriority" class="form-label">Priority</label>
                <select class="form-select" id="flagPriority">
                  <option value="1">Low</option>
                  <option value="2" selected>Medium</option>
                  <option value="3">High</option>
                  <option value="4">Critical</option>
                </select>
              </div>
            </form>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
            <button type="button" class="btn btn-info" onclick="app.submitBulkFlag()">Flag ${this.selectedItems.size} Items</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    const bsModal = new bootstrap.Modal(modal);
    bsModal.show();

    modal.addEventListener('hidden.bs.modal', () => {
      modal.remove();
    });
  }

  /**
   * Submit bulk flag operation
   */
  async submitBulkFlag() {
    const flagType = document.getElementById('flagType').value;
    const flagReason = document.getElementById('flagReason').value;
    const flagPriority = parseInt(document.getElementById('flagPriority').value);

    if (!flagType) {
      this.showErrorMessage('Please select a flag type');
      return;
    }

    try {
      const response = await this.apiCall('/api/review/bulk/flag', {
        method: 'POST',
        body: JSON.stringify({
          documentIds: Array.from(this.selectedItems),
          type: flagType,
          reason: flagReason,
          priority: flagPriority
        })
      });

      if (response.success) {
        this.showSuccessMessage(`Successfully flagged ${response.summary.successful} items`);
        this.clearSelection();
        await this.loadCurationData();
        
        // Close modal
        const modal = document.querySelector('.modal.show');
        if (modal) {
          bootstrap.Modal.getInstance(modal).hide();
        }
      } else {
        throw new Error(response.message || 'Failed to flag items');
      }
    } catch (error) {
      console.error('Error in bulk flag:', error);
      this.showErrorMessage('Failed to flag items: ' + error.message);
    }
  }

  /**
   * Bulk assign selected items
   */
  async bulkAssign() {
    if (this.selectedItems.size === 0) return;

    // Show modal to get assignment details
    const modal = document.createElement('div');
    modal.className = 'modal fade';
    modal.innerHTML = `
      <div class="modal-dialog">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">Bulk Assign Documents</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body">
            <form id="bulkAssignForm">
              <div class="mb-3">
                <label for="assignTo" class="form-label">Assign To *</label>
                <input type="text" class="form-control" id="assignTo" placeholder="Enter user ID or email" required>
              </div>
              <div class="mb-3">
                <label for="assignNotes" class="form-label">Notes</label>
                <textarea class="form-control" id="assignNotes" rows="3" placeholder="Optional assignment notes..."></textarea>
              </div>
            </form>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
            <button type="button" class="btn btn-primary" onclick="app.submitBulkAssign()">Assign ${this.selectedItems.size} Items</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    const bsModal = new bootstrap.Modal(modal);
    bsModal.show();

    modal.addEventListener('hidden.bs.modal', () => {
      modal.remove();
    });
  }

  /**
   * Submit bulk assign operation
   */
  async submitBulkAssign() {
    const assignTo = document.getElementById('assignTo').value.trim();
    const assignNotes = document.getElementById('assignNotes').value;

    if (!assignTo) {
      this.showErrorMessage('Please enter an assignee');
      return;
    }

    try {
      const response = await this.apiCall('/api/review/bulk/assign', {
        method: 'POST',
        body: JSON.stringify({
          documentIds: Array.from(this.selectedItems),
          assignTo: assignTo,
          notes: assignNotes
        })
      });

      if (response.success) {
        this.showSuccessMessage(`Successfully assigned ${response.summary.successful} items to ${assignTo}`);
        this.clearSelection();
        await this.loadCurationData();
        
        // Close modal
        const modal = document.querySelector('.modal.show');
        if (modal) {
          bootstrap.Modal.getInstance(modal).hide();
        }
      } else {
        throw new Error(response.message || 'Failed to assign items');
      }
    } catch (error) {
      console.error('Error in bulk assign:', error);
      this.showErrorMessage('Failed to assign items: ' + error.message);
    }
  }

  /**
   * Bulk add tags to selected items
   */
  async bulkAddTags() {
    if (this.selectedItems.size === 0) return;

    // Show modal to get tag details
    const modal = document.createElement('div');
    modal.className = 'modal fade';
    modal.innerHTML = `
      <div class="modal-dialog">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">Bulk Add Tags</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body">
            <form id="bulkAddTagsForm">
              <div class="mb-3">
                <label for="tagsToAdd" class="form-label">Tags to Add *</label>
                <input type="text" class="form-control" id="tagsToAdd" placeholder="Enter tags separated by commas" required>
                <div class="form-text">Example: urgent, review-needed, high-priority</div>
              </div>
              <div class="mb-3">
                <label for="tagNotes" class="form-label">Notes</label>
                <textarea class="form-control" id="tagNotes" rows="3" placeholder="Optional tagging notes..."></textarea>
              </div>
            </form>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
            <button type="button" class="btn btn-outline-primary" onclick="app.submitBulkAddTags()">Add Tags to ${this.selectedItems.size} Items</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    const bsModal = new bootstrap.Modal(modal);
    bsModal.show();

    modal.addEventListener('hidden.bs.modal', () => {
      modal.remove();
    });
  }

  /**
   * Submit bulk add tags operation
   */
  async submitBulkAddTags() {
    const tagsInput = document.getElementById('tagsToAdd').value.trim();
    const tagNotes = document.getElementById('tagNotes').value;

    if (!tagsInput) {
      this.showErrorMessage('Please enter tags to add');
      return;
    }

    const tags = tagsInput.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0);
    
    if (tags.length === 0) {
      this.showErrorMessage('Please enter valid tags');
      return;
    }

    try {
      const response = await this.apiCall('/api/review/bulk/add-tags', {
        method: 'POST',
        body: JSON.stringify({
          documentIds: Array.from(this.selectedItems),
          tags: tags,
          notes: tagNotes
        })
      });

      if (response.success) {
        this.showSuccessMessage(`Successfully added tags to ${response.summary.successful} items`);
        this.clearSelection();
        await this.loadCurationData();
        
        // Close modal
        const modal = document.querySelector('.modal.show');
        if (modal) {
          bootstrap.Modal.getInstance(modal).hide();
        }
      } else {
        throw new Error(response.message || 'Failed to add tags');
      }
    } catch (error) {
      console.error('Error in bulk add tags:', error);
      this.showErrorMessage('Failed to add tags: ' + error.message);
    }
  }

  /**
   * Bulk remove tags from selected items
   */
  async bulkRemoveTags() {
    if (this.selectedItems.size === 0) return;

    // Show modal to get tag details
    const modal = document.createElement('div');
    modal.className = 'modal fade';
    modal.innerHTML = `
      <div class="modal-dialog">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">Bulk Remove Tags</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body">
            <form id="bulkRemoveTagsForm">
              <div class="mb-3">
                <label for="tagsToRemove" class="form-label">Tags to Remove *</label>
                <input type="text" class="form-control" id="tagsToRemove" placeholder="Enter tags separated by commas" required>
                <div class="form-text">Example: urgent, review-needed, high-priority</div>
              </div>
              <div class="mb-3">
                <label for="removeTagNotes" class="form-label">Notes</label>
                <textarea class="form-control" id="removeTagNotes" rows="3" placeholder="Optional removal notes..."></textarea>
              </div>
            </form>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
            <button type="button" class="btn btn-outline-secondary" onclick="app.submitBulkRemoveTags()">Remove Tags from ${this.selectedItems.size} Items</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    const bsModal = new bootstrap.Modal(modal);
    bsModal.show();

    modal.addEventListener('hidden.bs.modal', () => {
      modal.remove();
    });
  }

  /**
   * Submit bulk remove tags operation
   */
  async submitBulkRemoveTags() {
    const tagsInput = document.getElementById('tagsToRemove').value.trim();
    const removeTagNotes = document.getElementById('removeTagNotes').value;

    if (!tagsInput) {
      this.showErrorMessage('Please enter tags to remove');
      return;
    }

    const tags = tagsInput.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0);
    
    if (tags.length === 0) {
      this.showErrorMessage('Please enter valid tags');
      return;
    }

    try {
      const response = await this.apiCall('/api/review/bulk/remove-tags', {
        method: 'POST',
        body: JSON.stringify({
          documentIds: Array.from(this.selectedItems),
          tags: tags,
          notes: removeTagNotes
        })
      });

      if (response.success) {
        this.showSuccessMessage(`Successfully removed tags from ${response.summary.successful} items`);
        this.clearSelection();
        await this.loadCurationData();
        
        // Close modal
        const modal = document.querySelector('.modal.show');
        if (modal) {
          bootstrap.Modal.getInstance(modal).hide();
        }
      } else {
        throw new Error(response.message || 'Failed to remove tags');
      }
    } catch (error) {
      console.error('Error in bulk remove tags:', error);
      this.showErrorMessage('Failed to remove tags: ' + error.message);
    }
  }

  /**
   * Refresh curation data
   */
  async refreshCurationData() {
    await this.loadCurationData();
    this.showSuccessMessage('Curation data refreshed');
  }

  /**
   * Helper methods
   */
  findItemById(itemId) {
    for (const status in this.curationData) {
      const item = this.curationData[status].find(item => item.id === itemId);
      if (item) return item;
    }
    return null;
  }

  getPriority(item) {
    if (item.flags?.includes('high-priority')) return 'priority-high';
    if (item.flags?.includes('medium-priority')) return 'priority-medium';
    return 'priority-low';
  }

  getSourceReliability(item) {
    const score = item.source?.reliabilityScore || 0.5;
    if (score >= 0.8) return 'high';
    if (score >= 0.5) return 'medium';
    return 'low';
  }

  getEmptyColumnHTML(status) {
    const messages = {
      pending: '<i class="bi bi-inbox fs-1"></i><p>No items pending review</p>',
      'in-review': '<i class="bi bi-search fs-1"></i><p>No items in review</p>',
      processed: '<i class="bi bi-check-all fs-1"></i><p>No processed items</p>'
    };
    
    return `
      <div class="text-center py-4 text-muted">
        ${messages[status] || '<p>No items</p>'}
      </div>
    `;
  }

  truncateText(text, maxLength) {
    if (!text) return '';
    return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
  }

  formatTimeAgo(dateString) {
    if (!dateString) return 'Unknown';
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
  }

  /**
   * Show/hide bulk curation actions
   */
  showBulkCurationActions() {
    // Implementation for bulk curation actions modal
    console.log('Show bulk curation actions');
  }

  /**
   * Show curation filters
   */
  showCurationFilters() {
    // Implementation for curation filters modal
    console.log('Show curation filters');
  }

  /**
   * Show curation stats
   */
  showCurationStats() {
    // Implementation for curation stats modal
    console.log('Show curation stats');
  }

  /**
   * Search curation content
   */
  searchCurationContent() {
    const query = document.getElementById('curation-search')?.value;
    console.log('Search curation content:', query);
    // Implementation for search functionality
  }

  /**
   * Search curation content
   */
  searchCurationContent() {
    const query = document.getElementById('curation-search')?.value;
    console.log('Search curation content:', query);
    // Implementation for search functionality
  }

  /**
   * Start review for an item
   */
  async startReview(itemId) {
    try {
      const response = await fetch(`/api/v1/review/start-review/${itemId}`, {
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          notes: 'Started review from curation board',
          timestamp: new Date().toISOString()
        })
      });

      if (!response.ok) {
        throw new Error(`Failed to start review: ${response.statusText}`);
      }

      this.showSuccessMessage('Review started');
      await this.loadCurationData();
      
    } catch (error) {
      console.error('Error starting review:', error);
      this.showErrorMessage('Failed to start review');
    }
  }

  /**
   * Open review modal for detailed review
   */
  openReviewModal(itemId) {
    // Switch to review view and open the specific item
    this.switchViewWithAnimation('review');
    // Set a timeout to allow view to load, then open the item
    setTimeout(() => {
      this.viewDocument(itemId);
    }, 500);
  }

  /**
   * View processed item details
   */
  viewProcessedItem(itemId) {
    const item = this.findItemById(itemId);
    if (!item) return;

    // Create a modal to show processed item details
    const modal = document.createElement('div');
    modal.className = 'modal fade';
    modal.id = 'processedItemModal';
    modal.innerHTML = `
      <div class="modal-dialog modal-lg">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">Processed Item Details</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body">
            <div class="row">
              <div class="col-md-6">
                <h6>Item Information</h6>
                <p><strong>Title:</strong> ${item.title || 'Untitled'}</p>
                <p><strong>Status:</strong> <span class="badge bg-${item.status === 'approved' ? 'success' : 'danger'}">${item.status}</span></p>
                <p><strong>Source:</strong> ${item.source?.name || 'Unknown'}</p>
                <p><strong>Created:</strong> ${this.formatTimeAgo(item.createdAt)}</p>
              </div>
              <div class="col-md-6">
                <h6>Content Preview</h6>
                <div class="border p-2 rounded" style="max-height: 200px; overflow-y: auto;">
                  ${item.contentPreview || item.content || 'No content available'}
                </div>
              </div>
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    const bsModal = new bootstrap.Modal(modal);
    bsModal.show();

    // Remove modal from DOM after hiding
    modal.addEventListener('hidden.bs.modal', () => {
      modal.remove();
    });
  }

  /**
   * Bulk start review for selected items
   */
  async bulkStartReview() {
    if (this.selectedItems.size === 0) return;

    try {
      const promises = Array.from(this.selectedItems).map(itemId => 
        this.startReview(itemId)
      );
      
      await Promise.all(promises);
      this.showSuccessMessage(`${this.selectedItems.size} items moved to review`);
      this.clearSelection();
      await this.loadCurationData();
      
    } catch (error) {
      console.error('Error in bulk start review:', error);
      this.showErrorMessage('Failed to start review for some items');
    }
  }

  // ===== END CURATION INTERFACE METHODS =====
}

// Global functions for backward compatibility
window.refreshReviewData = () => {
  if (window.app) {
    window.app.refreshData('review');
  }
};

window.refreshJobsData = () => {
  if (window.app) {
    window.app.refreshData('jobs');
  }
};

window.searchDocuments = () => {
  if (window.app) {
    const query = document.getElementById('search-input')?.value;
    window.app.searchQuery = query || '';
    window.app.currentPage = 1;
    window.app.loadReviewData();
  }
};

window.approveDocument = (documentId) => {
  if (window.app) {
    window.app.approveDocument(documentId);
  }
};

window.rejectDocument = (documentId) => {
  if (window.app) {
    window.app.rejectDocument(documentId);
  }
};

window.viewDocument = (documentId) => {
  if (window.app) {
    window.app.viewDocument(documentId);
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
window.app = app;
