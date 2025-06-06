// Categorization UI JavaScript

let selectedCategoryId = null;
let selectedDocumentIds = new Set();
let categories = [];
let documents = [];

// Initialize the categorization interface
document.addEventListener('DOMContentLoaded', () => {
  initializeEventListeners();
  loadCategories();
  loadDocuments();
});

// Event Listeners
function initializeEventListeners() {
  // Category tree events
  document.getElementById('categorySearch').addEventListener('input', filterCategories);
  document.getElementById('addCategoryBtn').addEventListener('click', showAddCategoryModal);
    
  // Document events
  document.getElementById('documentSearch').addEventListener('input', filterDocuments);
  document.getElementById('categoryFilter').addEventListener('change', filterDocuments);
    
  // Modal events
  document.querySelector('.modal-close').addEventListener('click', () => closeModal('addCategoryModal'));
  document.getElementById('addCategoryForm').addEventListener('submit', handleAddCategory);
  document.getElementById('addRuleBtn').addEventListener('click', addRuleField);
    
  // Bulk actions
  document.getElementById('bulkCategorizeBtn').addEventListener('click', bulkCategorize);
  document.getElementById('bulkSuggestBtn').addEventListener('click', bulkSuggest);
}

// Load categories from API
async function loadCategories() {
  try {
    const response = await fetch('/api/categorization/categories/hierarchy');
    const data = await response.json();
    categories = data.hierarchy || [];
    renderCategoryTree();
    updateCategoryFilter();
  } catch (error) {
    console.error('Failed to load categories:', error);
    showNotification('Failed to load categories', 'error');
  }
}

// Render category tree
function renderCategoryTree() {
  const treeContainer = document.getElementById('categoryTree');
  treeContainer.innerHTML = '';
    
  if (!categories || categories.length === 0) {
    treeContainer.innerHTML = '<div class="empty-state">No categories yet. Create your first category!</div>';
    return;
  }
    
  categories.forEach(category => {
    treeContainer.appendChild(renderCategoryNode(category));
  });
}

// Render individual category node
function renderCategoryNode(category, level = 0) {
  const node = document.createElement('div');
  node.className = 'category-node';
  node.style.marginLeft = `${level * 20}px`;
    
  const item = document.createElement('div');
  item.className = 'category-item';
  if (category.id === selectedCategoryId) {
    item.classList.add('selected');
  }
    
  item.innerHTML = `
        <span class="category-expand" onclick="toggleCategory(${category.id})">
            ${category.children && category.children.length > 0 ? '▼' : ''}
        </span>
        <span class="category-icon">📁</span>
        <span class="category-name">${escapeHtml(category.name)}</span>
        <span class="category-count">${category.document_count || 0}</span>
    `;
    
  item.addEventListener('click', (e) => {
    if (!e.target.classList.contains('category-expand')) {
      selectCategory(category.id);
    }
  });
    
  node.appendChild(item);
    
  // Add children container
  if (category.children && category.children.length > 0) {
    const childrenContainer = document.createElement('div');
    childrenContainer.className = 'category-children';
    childrenContainer.id = `children-${category.id}`;
        
    category.children.forEach(child => {
      childrenContainer.appendChild(renderCategoryNode(child, level + 1));
    });
        
    node.appendChild(childrenContainer);
  }
    
  return node;
}

// Select a category
async function selectCategory(categoryId) {
  selectedCategoryId = categoryId;
    
  // Update UI
  document.querySelectorAll('.category-item').forEach(item => {
    item.classList.remove('selected');
  });
  event.target.closest('.category-item').classList.add('selected');
    
  // Load category details
  await loadCategoryDetails(categoryId);
    
  // Filter documents by category
  document.getElementById('categoryFilter').value = categoryId;
  filterDocuments();
}

// Load category details
async function loadCategoryDetails(categoryId) {
  try {
    const response = await fetch(`/api/categorization/categories/${categoryId}`);
    const data = await response.json();
        
    showCategoryDetails(data);
  } catch (error) {
    console.error('Failed to load category details:', error);
  }
}

// Show category details
function showCategoryDetails(data) {
  const detailsPanel = document.getElementById('categoryDetails');
  const content = detailsPanel.querySelector('.details-content');
    
  content.innerHTML = `
        <div class="category-info">
            <h4>${escapeHtml(data.category.name)}</h4>
            <p class="category-path">${escapeHtml(data.category.path)}</p>
            <p class="category-description">${escapeHtml(data.category.description || 'No description')}</p>
        </div>
        
        <div class="category-stats">
            <div class="stat-item">
                <div class="stat-value">${data.stats.document_count || 0}</div>
                <div class="stat-label">Documents</div>
            </div>
            <div class="stat-item">
                <div class="stat-value">${data.stats.child_count || 0}</div>
                <div class="stat-label">Subcategories</div>
            </div>
            <div class="stat-item">
                <div class="stat-value">${data.stats.rule_count || 0}</div>
                <div class="stat-label">Rules</div>
            </div>
            <div class="stat-item">
                <div class="stat-value">${((data.stats.avg_confidence || 0) * 100).toFixed(0)}%</div>
                <div class="stat-label">Avg Confidence</div>
            </div>
        </div>
        
        <div class="category-rules">
            <h5>Categorization Rules</h5>
            ${renderCategoryRules(data.rules)}
        </div>
        
        <div class="category-actions">
            <button class="btn btn-secondary btn-sm" onclick="editCategory(${data.category.id})">Edit</button>
            <button class="btn btn-danger btn-sm" onclick="deleteCategory(${data.category.id})">Delete</button>
        </div>
    `;
    
  detailsPanel.style.display = 'block';
  document.getElementById('documentDetails').style.display = 'none';
}

// Render category rules
function renderCategoryRules(rules) {
  if (!rules || rules.length === 0) {
    return '<p class="text-muted">No rules defined</p>';
  }
    
  return rules.map(rule => `
        <div class="rule-item">
            <div class="rule-type">${rule.rule_type}</div>
            <div class="rule-pattern">${escapeHtml(rule.pattern)}</div>
            <div class="rule-confidence">Confidence: ${(rule.confidence * 100).toFixed(0)}%</div>
        </div>
    `).join('');
}

// Load documents
async function loadDocuments() {
  try {
    const response = await fetch('/api/review/documents?limit=50');
    const data = await response.json();
    documents = data.documents || [];
    renderDocuments();
  } catch (error) {
    console.error('Failed to load documents:', error);
  }
}

// Render documents
function renderDocuments() {
  const listContainer = document.getElementById('documentList');
  const filteredDocs = filterDocumentsList();
    
  if (filteredDocs.length === 0) {
    listContainer.innerHTML = '<div class="empty-state">No documents found</div>';
    return;
  }
    
  listContainer.innerHTML = filteredDocs.map(doc => `
        <div class="document-item ${selectedDocumentIds.has(doc.id) ? 'selected' : ''}" 
             data-id="${doc.id}" 
             onclick="toggleDocumentSelection('${doc.id}')">
            <div class="document-header">
                <h4 class="document-title">${escapeHtml(doc.title)}</h4>
                <div class="document-categories">
                    ${renderDocumentCategories(doc.categories)}
                </div>
            </div>
            <p class="document-preview">${escapeHtml(doc.contentPreview || doc.content || '')}</p>
            <div class="document-meta">
                <span>Source: ${escapeHtml(doc.source?.name || 'Unknown')}</span>
                <span>Created: ${formatDate(doc.createdAt)}</span>
            </div>
        </div>
    `).join('');
}

// Render document categories
function renderDocumentCategories(categories) {
  if (!categories || categories.length === 0) {
    return '<span class="text-muted">Uncategorized</span>';
  }
    
  return categories.map(cat => `
        <span class="category-tag">
            ${escapeHtml(cat.name)}
            <span class="category-confidence">${(cat.confidence * 100).toFixed(0)}%</span>
        </span>
    `).join('');
}

// Toggle document selection
function toggleDocumentSelection(documentId) {
  if (selectedDocumentIds.has(documentId)) {
    selectedDocumentIds.delete(documentId);
  } else {
    selectedDocumentIds.add(documentId);
  }
    
  // Update UI
  const element = document.querySelector(`[data-id="${documentId}"]`);
  element.classList.toggle('selected');
    
  // Show/hide bulk actions
  const bulkActions = document.getElementById('bulkActions');
  bulkActions.style.display = selectedDocumentIds.size > 0 ? 'block' : 'none';
    
  // Load document details if single selection
  if (selectedDocumentIds.size === 1) {
    loadDocumentDetails(documentId);
  }
}

// Load document categorization details
async function loadDocumentDetails(documentId) {
  try {
    const [historyResponse, suggestionsResponse] = await Promise.all([
      fetch(`/api/categorization/categorize/history/${documentId}`),
      fetch(`/api/categorization/categorize/suggest/${documentId}?limit=5`)
    ]);
        
    const history = await historyResponse.json();
    const suggestions = await suggestionsResponse.json();
        
    showDocumentDetails(documentId, history, suggestions);
  } catch (error) {
    console.error('Failed to load document details:', error);
  }
}

// Show document categorization details
function showDocumentDetails(documentId, history, suggestions) {
  const detailsPanel = document.getElementById('documentDetails');
  const content = detailsPanel.querySelector('.details-content');
    
  content.innerHTML = `
        <div class="current-categories">
            <h5>Current Categories</h5>
            ${renderCurrentCategories(history.history || [])}
        </div>
        
        <div class="suggestions-list">
            <h5>Suggested Categories</h5>
            ${renderSuggestions(suggestions.suggestions || [])}
        </div>
        
        <div class="manual-categorization">
            <h5>Manual Categorization</h5>
            <select id="manualCategorySelect" class="form-control">
                <option value="">Select a category...</option>
                ${renderCategoryOptions()}
            </select>
            <button class="btn btn-primary btn-sm" onclick="manualCategorize('${documentId}')">
                Add Category
            </button>
        </div>
    `;
    
  detailsPanel.style.display = 'block';
  document.getElementById('categoryDetails').style.display = 'none';
}

// Render current categories
function renderCurrentCategories(history) {
  if (history.length === 0) {
    return '<p class="text-muted">No categories assigned</p>';
  }
    
  return history.map(item => `
        <div class="category-assignment">
            <span class="category-name">${escapeHtml(item.category_name)}</span>
            <span class="category-confidence">${(item.confidence * 100).toFixed(0)}%</span>
            <span class="category-method">${item.is_manual ? 'Manual' : item.method}</span>
            <button class="btn btn-sm" onclick="removeCategory('${item.document_id}', ${item.category_id})">
                Remove
            </button>
        </div>
    `).join('');
}

// Render category suggestions
function renderSuggestions(suggestions) {
  if (suggestions.length === 0) {
    return '<p class="text-muted">No suggestions available</p>';
  }
    
  return suggestions.map(suggestion => `
        <div class="suggestion-item">
            <div class="suggestion-info">
                <div class="suggestion-name">${escapeHtml(suggestion.categoryPath)}</div>
                <div class="suggestion-explanation">${escapeHtml(suggestion.explanation || '')}</div>
            </div>
            <div class="suggestion-score">
                <div class="confidence-bar">
                    <div class="confidence-fill" style="width: ${suggestion.confidence * 100}%"></div>
                </div>
                <span>${(suggestion.confidence * 100).toFixed(0)}%</span>
            </div>
            <div class="suggestion-actions">
                <button class="btn btn-sm btn-primary" 
                        onclick="acceptSuggestion('${suggestion.documentId}', ${suggestion.categoryId})">
                    Accept
                </button>
            </div>
        </div>
    `).join('');
}

// Filter categories
function filterCategories() {
  const searchTerm = document.getElementById('categorySearch').value.toLowerCase();
  // Implement category filtering logic
}

// Filter documents
function filterDocuments() {
  renderDocuments();
}

// Filter documents list
function filterDocumentsList() {
  const searchTerm = document.getElementById('documentSearch').value.toLowerCase();
  const categoryFilter = document.getElementById('categoryFilter').value;
    
  return documents.filter(doc => {
    const matchesSearch = !searchTerm || 
            doc.title.toLowerCase().includes(searchTerm) ||
            (doc.content && doc.content.toLowerCase().includes(searchTerm));
            
    const matchesCategory = !categoryFilter || 
            (doc.categories && doc.categories.some(cat => cat.category_id == categoryFilter));
            
    return matchesSearch && matchesCategory;
  });
}

// Show add category modal
function showAddCategoryModal() {
  updateParentCategoryOptions();
  document.getElementById('addCategoryModal').style.display = 'flex';
}

// Close modal
function closeModal(modalId) {
  document.getElementById(modalId).style.display = 'none';
}

// Update parent category options
function updateParentCategoryOptions() {
  const select = document.getElementById('parentCategory');
  select.innerHTML = '<option value="">None (Root Category)</option>';
    
  function addOptions(categories, level = 0) {
    categories.forEach(category => {
      const option = document.createElement('option');
      option.value = category.id;
      option.textContent = '  '.repeat(level) + category.name;
      select.appendChild(option);
            
      if (category.children) {
        addOptions(category.children, level + 1);
      }
    });
  }
    
  addOptions(categories);
}

// Update category filter options
function updateCategoryFilter() {
  const select = document.getElementById('categoryFilter');
  select.innerHTML = '<option value="">All Categories</option>';
    
  function addOptions(categories, level = 0) {
    categories.forEach(category => {
      const option = document.createElement('option');
      option.value = category.id;
      option.textContent = '  '.repeat(level) + category.name;
      select.appendChild(option);
            
      if (category.children) {
        addOptions(category.children, level + 1);
      }
    });
  }
    
  addOptions(categories);
}

// Handle add category form submission
async function handleAddCategory(event) {
  event.preventDefault();
    
  const formData = new FormData(event.target);
  const rules = collectRules();
    
  const categoryData = {
    name: formData.get('name'),
    description: formData.get('description'),
    parentId: formData.get('parentId') || null,
    rules: rules
  };
    
  try {
    const response = await fetch('/api/categorization/categories', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getAuthToken()}`
      },
      body: JSON.stringify(categoryData)
    });
        
    if (response.ok) {
      showNotification('Category created successfully', 'success');
      closeModal('addCategoryModal');
      loadCategories();
      event.target.reset();
    } else {
      const error = await response.json();
      showNotification(error.message || 'Failed to create category', 'error');
    }
  } catch (error) {
    console.error('Failed to create category:', error);
    showNotification('Failed to create category', 'error');
  }
}

// Add rule field
function addRuleField() {
  const rulesContainer = document.getElementById('categoryRules');
  const ruleDiv = document.createElement('div');
  ruleDiv.className = 'rule-builder';
  ruleDiv.innerHTML = `
        <div class="rule-builder-header">
            <h6>Rule</h6>
            <button type="button" class="btn btn-sm" onclick="this.parentElement.parentElement.remove()">Remove</button>
        </div>
        <div class="rule-fields">
            <select name="ruleType" class="form-control">
                <option value="contains">Contains Keywords</option>
                <option value="regex">Regular Expression</option>
                <option value="entity">Entity Match</option>
                <option value="metadata">Metadata Match</option>
            </select>
            <input type="text" name="rulePattern" placeholder="Pattern" class="form-control" required>
            <input type="number" name="ruleConfidence" placeholder="Confidence (0-1)" 
                   min="0" max="1" step="0.1" value="0.8" class="form-control">
        </div>
    `;
  rulesContainer.insertBefore(ruleDiv, document.getElementById('addRuleBtn'));
}

// Collect rules from form
function collectRules() {
  const rules = [];
  document.querySelectorAll('.rule-builder').forEach(builder => {
    const type = builder.querySelector('[name="ruleType"]').value;
    const pattern = builder.querySelector('[name="rulePattern"]').value;
    const confidence = parseFloat(builder.querySelector('[name="ruleConfidence"]').value);
        
    if (pattern) {
      rules.push({ type, pattern, confidence });
    }
  });
  return rules;
}

// Bulk categorize
async function bulkCategorize() {
  if (selectedDocumentIds.size === 0) {
    showNotification('Please select documents to categorize', 'warning');
    return;
  }
    
  try {
    const response = await fetch('/api/categorization/categorize/batch', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getAuthToken()}`
      },
      body: JSON.stringify({
        documentIds: Array.from(selectedDocumentIds),
        options: {
          threshold: 0.6,
          maxCategories: 5
        }
      })
    });
        
    if (response.ok) {
      const result = await response.json();
      showNotification(`Batch categorization started for ${result.documentCount} documents`, 'success');
      selectedDocumentIds.clear();
      loadDocuments();
    }
  } catch (error) {
    console.error('Failed to start batch categorization:', error);
    showNotification('Failed to start batch categorization', 'error');
  }
}

// Accept suggestion
async function acceptSuggestion(documentId, categoryId) {
  try {
    const response = await fetch('/api/categorization/categorize/feedback', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getAuthToken()}`
      },
      body: JSON.stringify({
        documentId,
        categoryId,
        feedback: {
          type: 'accept',
          isCorrect: true
        }
      })
    });
        
    if (response.ok) {
      showNotification('Category accepted', 'success');
      loadDocumentDetails(documentId);
      loadDocuments();
    }
  } catch (error) {
    console.error('Failed to accept suggestion:', error);
    showNotification('Failed to accept suggestion', 'error');
  }
}

// Utility functions
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatDate(dateString) {
  return new Date(dateString).toLocaleDateString();
}

function getAuthToken() {
  // Get auth token from localStorage or cookie
  return localStorage.getItem('authToken') || '';
}

function showNotification(message, type = 'info') {
  // Implement notification display
  console.log(`[${type}] ${message}`);
}