type LeaveStatusChangedPayload = {
  leaveId: string;
  action: 'approved' | 'rejected';
  source: 'team' | 'chat' | 'other';
};

type LeaveStatusChangedListener = (payload: LeaveStatusChangedPayload) => void;
type TaskStatusChangedPayload = {
  taskId: string;
  status: string;
  source: 'tasks' | 'task_detail' | 'team' | 'other';
};
type TaskStatusChangedListener = (payload: TaskStatusChangedPayload) => void;
type MentionReadPayload = {
  mentionIds?: string[];
  source: 'notif_center' | 'chat' | 'other';
};
type MentionReadListener = (payload: MentionReadPayload) => void;
type CommunitySeenPayload = {
  seenAt: string;
  source: 'tab' | 'notif_center' | 'other';
};
type CommunitySeenListener = (payload: CommunitySeenPayload) => void;
type TaskNotificationsReadPayload = {
  source: 'tasks_tab' | 'notif_center' | 'other';
};
type TaskNotificationsReadListener = (payload: TaskNotificationsReadPayload) => void;

const leaveStatusChangedListeners = new Set<LeaveStatusChangedListener>();
const taskStatusChangedListeners = new Set<TaskStatusChangedListener>();
const mentionReadListeners = new Set<MentionReadListener>();
const communitySeenListeners = new Set<CommunitySeenListener>();
const taskNotificationsReadListeners = new Set<TaskNotificationsReadListener>();

export function emitLeaveStatusChanged(payload: LeaveStatusChangedPayload) {
  for (const fn of leaveStatusChangedListeners) {
    try {
      fn(payload);
    } catch {
      // ignore listener errors to avoid breaking emitter callsite
    }
  }
}

export function onLeaveStatusChanged(listener: LeaveStatusChangedListener) {
  leaveStatusChangedListeners.add(listener);
  return () => {
    leaveStatusChangedListeners.delete(listener);
  };
}

export function emitTaskStatusChanged(payload: TaskStatusChangedPayload) {
  for (const fn of taskStatusChangedListeners) {
    try {
      fn(payload);
    } catch {
      // ignore listener errors to avoid breaking emitter callsite
    }
  }
}

export function onTaskStatusChanged(listener: TaskStatusChangedListener) {
  taskStatusChangedListeners.add(listener);
  return () => {
    taskStatusChangedListeners.delete(listener);
  };
}

export function emitMentionRead(payload: MentionReadPayload) {
  for (const fn of mentionReadListeners) {
    try {
      fn(payload);
    } catch {
      // ignore listener errors to avoid breaking emitter callsite
    }
  }
}

export function onMentionRead(listener: MentionReadListener) {
  mentionReadListeners.add(listener);
  return () => {
    mentionReadListeners.delete(listener);
  };
}

export function emitCommunitySeen(payload: CommunitySeenPayload) {
  for (const fn of communitySeenListeners) {
    try {
      fn(payload);
    } catch {
      // ignore listener errors to avoid breaking emitter callsite
    }
  }
}

export function onCommunitySeen(listener: CommunitySeenListener) {
  communitySeenListeners.add(listener);
  return () => {
    communitySeenListeners.delete(listener);
  };
}

export function emitTaskNotificationsRead(payload: TaskNotificationsReadPayload) {
  for (const fn of taskNotificationsReadListeners) {
    try {
      fn(payload);
    } catch {
      // ignore listener errors to avoid breaking emitter callsite
    }
  }
}

export function onTaskNotificationsRead(listener: TaskNotificationsReadListener) {
  taskNotificationsReadListeners.add(listener);
  return () => {
    taskNotificationsReadListeners.delete(listener);
  };
}
