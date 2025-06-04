/**
 * Curation Board Component
 * Kanban-style interface for document curation with drag-and-drop
 */

import React, { useState, useEffect } from 'react';
import './CurationBoard.css';

const CurationBoard = ({ user, onItemUpdate }) => {
  const [items, setItems] = useState({
    pending: [],
    inReview: [],
    processed: []
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedItem, setSelectedItem] = useState(null);
  const [bulkSelection, setBulkSelection] = useState(new Set());

  useEffect(() => {
    loadCurationItems();
  }, []);

  const loadCurationItems = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/v1/curation/items', {
        headers: {
          'Authorization': `Bearer ${user.token}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) throw new Error('Failed to load curation items');
      
      const data = await response.json();
      setItems(data.items);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDragStart = (e, item, sourceColumn) => {
    e.dataTransfer.setData('text/plain', JSON.stringify({
      item,
      sourceColumn
    }));
  };

  const handleDragOver = (e) => {
    e.preventDefault();
  };

  const handleDrop = async (e, targetColumn) => {
    e.preventDefault();
    const data = JSON.parse(e.dataTransfer.getData('text/plain'));
    const { item, sourceColumn } = data;

    if (sourceColumn === targetColumn) return;

    try {
      await moveItem(item, sourceColumn, targetColumn);
    } catch (err) {
      setError(err.message);
    }
  };

  const moveItem = async (item, from, to) => {
    // Optimistic update
    const newItems = { ...items };
    newItems[from] = newItems[from].filter(i => i.id !== item.id);
    newItems[to] = [...newItems[to], { ...item, status: to }];
    setItems(newItems);

    try {
      const response = await fetch(`/api/v1/curation/items/${item.id}/move`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${user.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from,
          to,
          curatorId: user.id
        })
      });

      if (!response.ok) {
        // Rollback on error
        loadCurationItems();
        throw new Error('Failed to move item');
      }

      const updated = await response.json();
      onItemUpdate?.(updated.item);
    } catch (err) {
      throw err;
    }
  };

  const handleItemClick = (item) => {
    setSelectedItem(item);
  };

  const handleBulkSelect = (itemId) => {
    const newSelection = new Set(bulkSelection);
    if (newSelection.has(itemId)) {
      newSelection.delete(itemId);
    } else {
      newSelection.add(itemId);
    }
    setBulkSelection(newSelection);
  };

  const handleBulkAction = async (action, reason = '') => {
    if (bulkSelection.size === 0) return;

    try {
      const response = await fetch('/api/v1/curation/bulk', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${user.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          action,
          itemIds: Array.from(bulkSelection),
          reason,
          curatorId: user.id
        })
      });

      if (!response.ok) throw new Error(`Failed to ${action} items`);

      setBulkSelection(new Set());
      loadCurationItems();
    } catch (err) {
      setError(err.message);
    }
  };

  const renderItem = (item, column) => (
    <div
      key={item.id}
      className={`curation-item ${bulkSelection.has(item.id) ? 'selected' : ''}`}
      draggable
      onDragStart={(e) => handleDragStart(e, item, column)}
      onClick={() => handleItemClick(item)}
    >
      <div className="item-header">
        <input
          type="checkbox"
          checked={bulkSelection.has(item.id)}
          onChange={() => handleBulkSelect(item.id)}
          onClick={(e) => e.stopPropagation()}
        />
        <span className="item-type">{item.sourceType}</span>
        <span className={`item-priority priority-${item.priority}`}>
          {item.priority}
        </span>
      </div>
      
      <h4 className="item-title">{item.title || 'Untitled'}</h4>
      
      <div className="item-preview">
        {item.contentPreview?.substring(0, 150)}...
      </div>
      
      <div className="item-metadata">
        <span className="item-source">{item.sourceName}</span>
        <span className="item-date">
          {new Date(item.createdAt).toLocaleDateString()}
        </span>
      </div>
      
      {item.tags && (
        <div className="item-tags">
          {item.tags.slice(0, 3).map(tag => (
            <span key={tag} className="tag">{tag}</span>
          ))}
        </div>
      )}
    </div>
  );

  const renderColumn = (title, items, columnKey) => (
    <div
      className={`curation-column column-${columnKey}`}
      onDragOver={handleDragOver}
      onDrop={(e) => handleDrop(e, columnKey)}
    >
      <div className="column-header">
        <h3>{title}</h3>
        <span className="item-count">{items.length}</span>
      </div>
      
      <div className="column-items">
        {items.map(item => renderItem(item, columnKey))}
      </div>
    </div>
  );

  if (loading) {
    return <div className="curation-loading">Loading curation items...</div>;
  }

  if (error) {
    return (
      <div className="curation-error">
        Error: {error}
        <button onClick={loadCurationItems}>Retry</button>
      </div>
    );
  }

  return (
    <div className="curation-board">
      <div className="board-header">
        <h2>Document Curation</h2>
        
        {bulkSelection.size > 0 && (
          <div className="bulk-actions">
            <span>{bulkSelection.size} items selected</span>
            <button
              className="bulk-approve"
              onClick={() => handleBulkAction('approve')}
            >
              Bulk Approve
            </button>
            <button
              className="bulk-reject"
              onClick={() => {
                const reason = prompt('Rejection reason:');
                if (reason) handleBulkAction('reject', reason);
              }}
            >
              Bulk Reject
            </button>
            <button
              className="bulk-clear"
              onClick={() => setBulkSelection(new Set())}
            >
              Clear Selection
            </button>
          </div>
        )}
      </div>

      <div className="board-columns">
        {renderColumn('Pending Review', items.pending, 'pending')}
        {renderColumn('In Review', items.inReview, 'inReview')}
        {renderColumn('Processed', items.processed, 'processed')}
      </div>

      {selectedItem && (
        <ItemDetailModal
          item={selectedItem}
          user={user}
          onClose={() => setSelectedItem(null)}
          onUpdate={(updated) => {
            onItemUpdate?.(updated);
            loadCurationItems();
          }}
        />
      )}
    </div>
  );
};

// Item Detail Modal Component
const ItemDetailModal = ({ item, user, onClose, onUpdate }) => {
  const [decision, setDecision] = useState('');
  const [notes, setNotes] = useState('');
  const [editedContent, setEditedContent] = useState(item.content || '');
  const [tags, setTags] = useState(item.tags || []);
  const [visibility, setVisibility] = useState(item.visibility || 'internal');

  const handleDecision = async (action) => {
    try {
      const response = await fetch(`/api/v1/curation/decision`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${user.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          itemId: item.id,
          decision: action,
          curatorId: user.id,
          notes,
          editedContent: action === 'APPROVE' ? editedContent : undefined,
          tags: action === 'APPROVE' ? tags : undefined,
          visibilityFlag: action === 'APPROVE' ? visibility : undefined
        })
      });

      if (!response.ok) throw new Error(`Failed to ${action.toLowerCase()} item`);

      const result = await response.json();
      onUpdate(result.item);
      onClose();
    } catch (err) {
      alert(`Error: ${err.message}`);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="item-detail-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{item.title || 'Document Review'}</h3>
          <button className="close-button" onClick={onClose}>&times;</button>
        </div>

        <div className="modal-content">
          <div className="item-info">
            <p><strong>Source:</strong> {item.sourceName}</p>
            <p><strong>Type:</strong> {item.sourceType}</p>
            <p><strong>Created:</strong> {new Date(item.createdAt).toLocaleString()}</p>
            <p><strong>Priority:</strong> {item.priority}</p>
          </div>

          <div className="content-editor">
            <label>Content:</label>
            <textarea
              value={editedContent}
              onChange={(e) => setEditedContent(e.target.value)}
              rows={10}
              className="content-textarea"
            />
          </div>

          <div className="metadata-editor">
            <div className="tags-editor">
              <label>Tags:</label>
              <input
                type="text"
                value={tags.join(', ')}
                onChange={(e) => setTags(e.target.value.split(',').map(t => t.trim()))}
                placeholder="tag1, tag2, tag3"
              />
            </div>

            <div className="visibility-selector">
              <label>Visibility:</label>
              <select value={visibility} onChange={(e) => setVisibility(e.target.value)}>
                <option value="internal">Internal</option>
                <option value="external">External</option>
                <option value="restricted">Restricted</option>
              </select>
            </div>
          </div>

          <div className="curator-notes">
            <label>Curator Notes:</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Add your review notes..."
            />
          </div>
        </div>

        <div className="modal-actions">
          <button
            className="approve-button"
            onClick={() => handleDecision('APPROVE')}
          >
            Approve & Publish
          </button>
          <button
            className="reject-button"
            onClick={() => handleDecision('REJECT')}
          >
            Reject
          </button>
          <button className="cancel-button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

export default CurationBoard;