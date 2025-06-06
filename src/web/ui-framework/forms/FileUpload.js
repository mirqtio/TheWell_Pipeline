/**
 * File Upload Component
 * Drag-and-drop file upload with progress tracking
 */

import React, { useState, useRef, useCallback } from 'react';
import classNames from 'classnames';
import { Button } from '../components/Button';
import './FileUpload.css';

export const FileUpload = ({
  accept,
  multiple = false,
  maxSize = 10 * 1024 * 1024, // 10MB default
  onUpload,
  onError,
  className,
  disabled = false,
  label = 'Choose files or drag and drop',
  helper,
  error,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [files, setFiles] = useState([]);
  const [uploadProgress, setUploadProgress] = useState({});
  const fileInputRef = useRef(null);

  const classes = classNames(
    'tw-file-upload',
    {
      'tw-file-upload--dragging': isDragging,
      'tw-file-upload--disabled': disabled,
      'tw-file-upload--error': error,
    },
    className
  );

  const validateFile = (file) => {
    if (maxSize && file.size > maxSize) {
      return `File size exceeds ${formatFileSize(maxSize)}`;
    }
    
    if (accept) {
      const acceptedTypes = accept.split(',').map(type => type.trim());
      const fileType = file.type;
      const fileExtension = `.${file.name.split('.').pop()}`;
      
      const isAccepted = acceptedTypes.some(type => {
        if (type.startsWith('.')) {
          return fileExtension.toLowerCase() === type.toLowerCase();
        }
        if (type.endsWith('/*')) {
          return fileType.startsWith(type.replace('/*', ''));
        }
        return fileType === type;
      });
      
      if (!isAccepted) {
        return `File type not accepted. Accepted types: ${accept}`;
      }
    }
    
    return null;
  };

  const handleFiles = useCallback(async (fileList) => {
    const newFiles = Array.from(fileList);
    const validFiles = [];
    const errors = [];

    newFiles.forEach(file => {
      const error = validateFile(file);
      if (error) {
        errors.push({ file: file.name, error });
      } else {
        validFiles.push(file);
      }
    });

    if (errors.length > 0 && onError) {
      onError(errors);
    }

    if (validFiles.length > 0) {
      if (!multiple) {
        setFiles([validFiles[0]]);
      } else {
        setFiles(prev => [...prev, ...validFiles]);
      }

      if (onUpload) {
        for (const file of validFiles) {
          const fileId = Math.random().toString(36).substr(2, 9);
          
          // Simulate upload progress
          setUploadProgress(prev => ({ ...prev, [fileId]: 0 }));
          
          try {
            await onUpload(file, (progress) => {
              setUploadProgress(prev => ({ ...prev, [fileId]: progress }));
            });
            
            setUploadProgress(prev => ({ ...prev, [fileId]: 100 }));
          } catch (error) {
            console.error('Upload error:', error);
            setUploadProgress(prev => {
              const { [fileId]: _, ...rest } = prev;
              return rest;
            });
          }
        }
      }
    }
  }, [multiple, onUpload, onError]);

  const handleDragEnter = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    
    if (!disabled) {
      handleFiles(e.dataTransfer.files);
    }
  };

  const handleFileSelect = (e) => {
    handleFiles(e.target.files);
  };

  const handleClick = () => {
    if (!disabled && fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const removeFile = (index) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className="tw-file-upload-container">
      <div
        className={classes}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onClick={handleClick}
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-disabled={disabled}
      >
        <input
          ref={fileInputRef}
          type="file"
          className="tw-file-upload__input"
          accept={accept}
          multiple={multiple}
          onChange={handleFileSelect}
          disabled={disabled}
          aria-hidden="true"
        />
        
        <div className="tw-file-upload__content">
          <div className="tw-file-upload__icon">
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
              <path
                d="M24 32V16M24 16L18 22M24 16L30 22"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M40 28V36C40 37.0609 39.5786 38.0783 38.8284 38.8284C38.0783 39.5786 37.0609 40 36 40H12C10.9391 40 9.92172 39.5786 9.17157 38.8284C8.42143 38.0783 8 37.0609 8 36V28"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          
          <div className="tw-file-upload__text">
            <p className="tw-file-upload__label">{label}</p>
            {helper && !error && (
              <p className="tw-file-upload__helper">{helper}</p>
            )}
          </div>
          
          <Button variant="secondary" size="sm" disabled={disabled}>
            Browse Files
          </Button>
        </div>
      </div>
      
      {error && (
        <div className="tw-file-upload__error" role="alert">
          {error}
        </div>
      )}
      
      {files.length > 0 && (
        <div className="tw-file-upload__files">
          {files.map((file, index) => {
            const fileId = `${file.name}-${index}`;
            const progress = uploadProgress[fileId];
            
            return (
              <div key={index} className="tw-file-upload__file">
                <div className="tw-file-upload__file-info">
                  <span className="tw-file-upload__file-name">{file.name}</span>
                  <span className="tw-file-upload__file-size">
                    {formatFileSize(file.size)}
                  </span>
                </div>
                
                {progress !== undefined && progress < 100 && (
                  <div className="tw-file-upload__progress">
                    <div
                      className="tw-file-upload__progress-bar"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                )}
                
                <button
                  className="tw-file-upload__file-remove"
                  onClick={() => removeFile(index)}
                  aria-label={`Remove ${file.name}`}
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path
                      d="M12 4L4 12M4 4L12 12"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};