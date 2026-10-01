import SourceNode from './SourceNode';
import CropNode from './CropNode';
import MaskNode from './MaskNode';
import TransformNode from './TransformNode';
import BlurNode from './BlurNode';
import BlendNode from './BlendNode';
import MergeNode from './MergeNode';
import OutputNode from './OutputNode';
import ConcatNode from './ConcatNode';
import AudioNode from './AudioNode';

export const nodeTypes = {
  source: SourceNode,
  crop: CropNode,
  mask: MaskNode,
  transform: TransformNode,
  blur: BlurNode,
  blend: BlendNode,
  merge: MergeNode,
  output: OutputNode,
  concat: ConcatNode,
  audio: AudioNode,
};

export { SourceNode, CropNode, MaskNode, TransformNode, BlurNode, BlendNode, MergeNode, OutputNode, ConcatNode, AudioNode };
