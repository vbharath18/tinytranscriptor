import React from 'react';
import { WHISPER_MODELS, type WhisperModelKey } from '../hooks/useTranscription'; // Adjust path as needed

interface BrowserCompatibilityDisplayProps {
  browserCompatibility: {
    isCompatible: boolean;
    warnings: string[];
    recommendedModel: WhisperModelKey;
  } | null;
  whisperModels: typeof WHISPER_MODELS;
}

const BrowserCompatibilityDisplay: React.FC<BrowserCompatibilityDisplayProps> = ({ browserCompatibility, whisperModels }) => {
  if (!browserCompatibility || browserCompatibility.warnings.length === 0) {
    return null;
  }

  return (
    <div className="compatibility-warnings">
      <h3>⚠️ Browser Compatibility Notices</h3>
      {browserCompatibility.warnings.map((warning, index) => (
        <div key={index} className="warning-item">
          {warning}
        </div>
      ))}
      {browserCompatibility.recommendedModel && whisperModels[browserCompatibility.recommendedModel] && (
        <div className="recommendation">
          💡 Recommended model for your setup: <strong>{whisperModels[browserCompatibility.recommendedModel].name}</strong>
        </div>
      )}
    </div>
  );
};

export default BrowserCompatibilityDisplay;
