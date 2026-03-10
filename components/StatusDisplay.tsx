'use client';

interface StatusDisplayProps {
  step: number;
  message: string;
  timestamp?: number;
}

export default function StatusDisplay({ step, message, timestamp }: StatusDisplayProps) {
  return (
    <div className="flex items-start gap-3 p-4 border border-gray-200 rounded">
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-500 text-white flex items-center justify-center font-semibold text-sm">
        {step}
      </div>
      <div className="flex-1">
        <p className="text-gray-900 font-medium">{message}</p>
        {timestamp && (
          <p className="text-gray-500 text-xs mt-1">
            {new Date(timestamp * 1000).toLocaleTimeString()}
          </p>
        )}
      </div>
    </div>
  );
}

