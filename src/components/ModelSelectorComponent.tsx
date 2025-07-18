import React from 'react';
import { WHISPER_MODELS, type WhisperModelKey } from '../hooks/useTranscription'; // Adjust path as needed

interface ModelSelectorComponentProps {
  selectedModel: WhisperModelKey;
  setSelectedModel: (modelKey: WhisperModelKey) => void;
  modelLoading: boolean;
  transcriptionLoading: boolean;
  whisperModels: typeof WHISPER_MODELS;
}

const ModelSelectorComponent: React.FC<ModelSelectorComponentProps> = ({
  selectedModel,
  setSelectedModel,
  modelLoading,
  transcriptionLoading,
  whisperModels,
}) => {
  return (
    <div className="model-selector">
      <label htmlFor="model-select">Whisper Model:</label>
      <select
        id="model-select"
        value={selectedModel}
        onChange={(e) => setSelectedModel(e.target.value as WhisperModelKey)}
        disabled={modelLoading || transcriptionLoading}
      >
        <optgroup label="Tiny Models (Most Stable)">
          <option value="tiny.en">🇺🇸 Tiny English ({whisperModels['tiny.en'].size}) - Recommended</option>
          <option value="tiny">🌍 Tiny Multilingual ({whisperModels['tiny'].size})</option>
        </optgroup>
        <optgroup label="Base Models (Good Balance)">
          <option value="base.en">🇺🇸 Base English ({whisperModels['base.en'].size})</option>
          <option value="base">🌍 Base Multilingual ({whisperModels['base'].size})</option>
        </optgroup>
        <optgroup label="Small Models (Higher Quality)">
          <option value="small.en">🇺🇸 Small English ({whisperModels['small.en'].size})</option>
          <option value="small">🌍 Small Multilingual ({whisperModels['small'].size})</option>
        </optgroup>
        <optgroup label="Advanced Models (Experimental)">
          <option value="voxtral">🔊 Voxtral ({whisperModels['voxtral'].size})</option>
        </optgroup>
      </select>
      <div className="model-info">
        <span className="model-stats">
          📊 {whisperModels[selectedModel].speed} speed,
          {/* Add accuracy or other stats if needed */}
        </span>
      </div>
    </div>
  );
};

export default ModelSelectorComponent;
