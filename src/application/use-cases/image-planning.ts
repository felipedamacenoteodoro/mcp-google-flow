import { describeImageTask, IMAGE_TASK_IDS, planImageTask } from '../../domain/image-tasks.js';
import type { ImageTaskDetails, ImageTaskId, ImageTaskPlan } from '../../domain/image-tasks.js';

/** Writes base-image prompts. Pure: no browser involved, nothing spent. */
export class ImagePlanningUseCases {
  tasks() {
    return IMAGE_TASK_IDS.map((id) => ({ id, ...describeImageTask(id) }));
  }

  imagePrompt(task: ImageTaskId, details: ImageTaskDetails): ImageTaskPlan {
    return planImageTask(task, details);
  }
}
