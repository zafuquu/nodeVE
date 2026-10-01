import { useCallback } from 'react';

/**
 * useNodeData — shared hook for node data updates (P1-2)
 *
 * Replaces the identical handleChange pattern duplicated across
 * CropNode, MaskNode, TransformNode, and BlurNode.
 */
export function useNodeData(id, data) {
  const handleChange = useCallback(
    (field, value) => {
      let val = value;
      if (typeof value === 'string') {
        const num = Number(value);
        if (!isNaN(num) && value.trim() !== '') {
          val = num;
        }
      }
      data.updateNodeData?.(id, {
        [field]: val,
      });
    },
    [id, data]
  );

  const handleDelete = useCallback(
    () => data.deleteNode?.(id),
    [id, data]
  );

  return { handleChange, handleDelete };
}

