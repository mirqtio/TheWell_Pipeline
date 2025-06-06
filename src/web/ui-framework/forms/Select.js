/**
 * Select Component
 * Dropdown select with support for custom styling
 */

import React, { forwardRef } from 'react';
import classNames from 'classnames';
import './Select.css';

export const Select = forwardRef(({
  options = [],
  size = 'md',
  label,
  helper,
  error,
  required = false,
  disabled = false,
  placeholder = 'Select an option',
  className,
  containerClassName,
  id,
  ...props
}, ref) => {
  const selectId = id || `select-${Math.random().toString(36).substr(2, 9)}`;
  
  const containerClasses = classNames(
    'tw-select-container',
    containerClassName
  );
  
  const selectClasses = classNames(
    'tw-select',
    `tw-select--${size}`,
    {
      'tw-select--error': error,
      'tw-select--disabled': disabled,
    },
    className
  );

  return (
    <div className={containerClasses}>
      {label && (
        <label htmlFor={selectId} className="tw-select__label">
          {label}
          {required && <span className="tw-select__required" aria-label="required">*</span>}
        </label>
      )}
      
      <div className="tw-select__wrapper">
        <select
          ref={ref}
          id={selectId}
          className={selectClasses}
          disabled={disabled}
          aria-invalid={!!error}
          aria-describedby={
            error ? `${selectId}-error` :
              helper ? `${selectId}-helper` :
                undefined
          }
          {...props}
        >
          {placeholder && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          
          {options.map((option, index) => {
            if (option.group) {
              return (
                <optgroup key={index} label={option.label}>
                  {option.options.map((groupOption) => (
                    <option
                      key={groupOption.value}
                      value={groupOption.value}
                      disabled={groupOption.disabled}
                    >
                      {groupOption.label}
                    </option>
                  ))}
                </optgroup>
              );
            }
            
            return (
              <option
                key={option.value}
                value={option.value}
                disabled={option.disabled}
              >
                {option.label}
              </option>
            );
          })}
        </select>
        
        <div className="tw-select__icon" aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path
              d="M5 7.5L10 12.5L15 7.5"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </div>
      
      {error && (
        <div id={`${selectId}-error`} className="tw-select__error" role="alert">
          {error}
        </div>
      )}
      
      {!error && helper && (
        <div id={`${selectId}-helper`} className="tw-select__helper">
          {helper}
        </div>
      )}
    </div>
  );
});

Select.displayName = 'Select';