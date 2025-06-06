/**
 * Input Component
 * Text input with validation and various states
 */

import React, { forwardRef } from 'react';
import classNames from 'classnames';
import './Input.css';

export const INPUT_TYPES = {
  TEXT: 'text',
  EMAIL: 'email',
  PASSWORD: 'password',
  NUMBER: 'number',
  TEL: 'tel',
  URL: 'url',
  SEARCH: 'search',
};

export const INPUT_SIZES = {
  SM: 'sm',
  MD: 'md',
  LG: 'lg',
};

export const Input = forwardRef(({
  type = INPUT_TYPES.TEXT,
  size = INPUT_SIZES.MD,
  label,
  helper,
  error,
  success,
  required = false,
  disabled = false,
  readOnly = false,
  prefix,
  suffix,
  className,
  containerClassName,
  id,
  ...props
}, ref) => {
  const inputId = id || `input-${Math.random().toString(36).substr(2, 9)}`;
  
  const containerClasses = classNames(
    'tw-input-container',
    containerClassName
  );
  
  const inputClasses = classNames(
    'tw-input',
    `tw-input--${size}`,
    {
      'tw-input--error': error,
      'tw-input--success': success,
      'tw-input--disabled': disabled,
      'tw-input--readonly': readOnly,
      'tw-input--with-prefix': prefix,
      'tw-input--with-suffix': suffix,
    },
    className
  );

  return (
    <div className={containerClasses}>
      {label && (
        <label htmlFor={inputId} className="tw-input__label">
          {label}
          {required && <span className="tw-input__required" aria-label="required">*</span>}
        </label>
      )}
      
      <div className="tw-input__wrapper">
        {prefix && (
          <div className="tw-input__prefix">
            {prefix}
          </div>
        )}
        
        <input
          ref={ref}
          id={inputId}
          type={type}
          className={inputClasses}
          disabled={disabled}
          readOnly={readOnly}
          aria-invalid={!!error}
          aria-describedby={
            error ? `${inputId}-error` :
            helper ? `${inputId}-helper` :
            undefined
          }
          {...props}
        />
        
        {suffix && (
          <div className="tw-input__suffix">
            {suffix}
          </div>
        )}
      </div>
      
      {error && (
        <div id={`${inputId}-error`} className="tw-input__error" role="alert">
          {error}
        </div>
      )}
      
      {!error && helper && (
        <div id={`${inputId}-helper`} className="tw-input__helper">
          {helper}
        </div>
      )}
    </div>
  );
});

Input.displayName = 'Input';

// Textarea Component
export const Textarea = forwardRef(({
  size = INPUT_SIZES.MD,
  label,
  helper,
  error,
  success,
  required = false,
  disabled = false,
  readOnly = false,
  rows = 4,
  resize = 'vertical',
  className,
  containerClassName,
  id,
  ...props
}, ref) => {
  const textareaId = id || `textarea-${Math.random().toString(36).substr(2, 9)}`;
  
  const containerClasses = classNames(
    'tw-input-container',
    containerClassName
  );
  
  const textareaClasses = classNames(
    'tw-input',
    'tw-textarea',
    `tw-input--${size}`,
    `tw-textarea--resize-${resize}`,
    {
      'tw-input--error': error,
      'tw-input--success': success,
      'tw-input--disabled': disabled,
      'tw-input--readonly': readOnly,
    },
    className
  );

  return (
    <div className={containerClasses}>
      {label && (
        <label htmlFor={textareaId} className="tw-input__label">
          {label}
          {required && <span className="tw-input__required" aria-label="required">*</span>}
        </label>
      )}
      
      <textarea
        ref={ref}
        id={textareaId}
        rows={rows}
        className={textareaClasses}
        disabled={disabled}
        readOnly={readOnly}
        aria-invalid={!!error}
        aria-describedby={
          error ? `${textareaId}-error` :
          helper ? `${textareaId}-helper` :
          undefined
        }
        {...props}
      />
      
      {error && (
        <div id={`${textareaId}-error`} className="tw-input__error" role="alert">
          {error}
        </div>
      )}
      
      {!error && helper && (
        <div id={`${textareaId}-helper`} className="tw-input__helper">
          {helper}
        </div>
      )}
    </div>
  );
});

Textarea.displayName = 'Textarea';