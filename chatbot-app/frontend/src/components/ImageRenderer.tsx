import React, { useState } from 'react';

interface ImageRendererProps {
  imageId: string;
  altText?: string;
  sessionId?: string;
  toolUseId?: string;
}

export const ImageRenderer: React.FC<ImageRendererProps> = ({ 
  imageId, 
  altText = 'Generated Image',
  sessionId,
  toolUseId 
}) => {
  const [imageError, setImageError] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Use backend API endpoint for tool_use_id-specific images
  const imagePath = sessionId && toolUseId 
    ? `/api/files/images/${sessionId}/${toolUseId}/${imageId}`
    : `/output/${imageId}`; // Fallback to old path for images without session/toolUse context

  const handleImageError = () => {
    setImageError(true);
    setIsLoading(false);
  };

  const handleImageLoad = () => {
    setIsLoading(false);
  };

  if (imageError) {
    return (
      <div className="my-6 p-4 border-2 border-dashed border-gray-300 rounded-lg bg-gray-50 text-center">
        <div className="text-gray-500">
          <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <p className="mt-2 text-label font-medium text-gray-900">Image not available</p>
          <p className="text-caption text-gray-500">{altText}</p>
          <p className="text-caption text-gray-400 mt-1">Path: {imagePath}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="my-6 text-center">
      {isLoading && (
        <div className="inline-block">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <p className="mt-2 text-label text-gray-500">Loading image...</p>
        </div>
      )}
      <img 
        src={imagePath}
        alt={altText}
        onError={handleImageError}
        onLoad={handleImageLoad}
        className={`max-w-full h-auto rounded-lg shadow-md ${isLoading ? 'hidden' : 'block'}`}
        style={{ maxHeight: '400px' }}
      />
      {!isLoading && !imageError && (
        <p className="mt-2 text-label text-gray-600 italic">{altText}</p>
      )}
    </div>
  );
};
