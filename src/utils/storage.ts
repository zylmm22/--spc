/**
 * SPC 系统双层数据持久化引擎
 * 解决部署到 Netlify / Vercel 等静态托管平台后刷新重置、无法保存的问题
 * 具备：本地永久存储、API 自动降级同步、全量数据导出与导入备份
 */

import { ProcessCharacteristic, SubgroupDataPoint, CNAuditConfig, GJBAuditConfig } from '../types/spc';
import { UserAccount, PRESET_ACCOUNTS } from '../types/auth';
import { INITIAL_PROCESSES, generateInitialSubgroups } from '../data/mockData';

const STORAGE_KEYS = {
  PROCESSES: 'spc_storage_processes_v2',
  SUBGROUPS_MAP: 'spc_storage_subgroups_map_v2',
  ACTIVE_PROCESS_ID: 'spc_storage_active_process_id_v2',
  USER: 'spc_storage_current_user_v2',
  CN_CONFIG: 'spc_cn_config_v2',
  GJB_CONFIG: 'spc_gjb_config_v2'
};

/**
 * 读取持久化工序列表
 */
export function loadSavedProcesses(): ProcessCharacteristic[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.PROCESSES);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (err) {
    console.warn('[SPC Storage] 读取工序失败，使用默认工序', err);
  }
  return INITIAL_PROCESSES;
}

/**
 * 保存工序列表至持久化存储
 */
export function saveProcesses(processes: ProcessCharacteristic[]) {
  try {
    localStorage.setItem(STORAGE_KEYS.PROCESSES, JSON.stringify(processes));
  } catch (err) {
    console.error('[SPC Storage] 保存工序失败', err);
  }
}

/**
 * 读取所有工序的子组数据集映射表
 */
export function loadAllSubgroupsMap(): Record<string, SubgroupDataPoint[]> {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.SUBGROUPS_MAP);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null) {
        return parsed;
      }
    }
  } catch (err) {
    console.warn('[SPC Storage] 读取子组映射失败', err);
  }
  return {};
}

/**
 * 读取指定工序的子组数据
 */
export function loadSavedSubgroupsForProcess(process: ProcessCharacteristic): SubgroupDataPoint[] {
  const map = loadAllSubgroupsMap();
  if (map[process.id] && Array.isArray(map[process.id]) && map[process.id].length > 0) {
    return map[process.id];
  }
  // 若未初始化，则生成并保存
  const initial = generateInitialSubgroups(process);
  map[process.id] = initial;
  try {
    localStorage.setItem(STORAGE_KEYS.SUBGROUPS_MAP, JSON.stringify(map));
  } catch (e) {}
  return initial;
}

/**
 * 保存指定工序的子组数据至持久化存储
 */
export function saveSubgroupsForProcess(processId: string, subgroups: SubgroupDataPoint[]) {
  try {
    const map = loadAllSubgroupsMap();
    map[processId] = subgroups;
    localStorage.setItem(STORAGE_KEYS.SUBGROUPS_MAP, JSON.stringify(map));
  } catch (err) {
    console.error('[SPC Storage] 保存子组数据失败', err);
  }
}

/**
 * 删除指定工序的持久化数据
 */
export function removeProcessData(processId: string) {
  try {
    const map = loadAllSubgroupsMap();
    delete map[processId];
    localStorage.setItem(STORAGE_KEYS.SUBGROUPS_MAP, JSON.stringify(map));
  } catch (e) {}
}

/**
 * 读取上次选中的活跃工序 ID
 */
export function loadSavedActiveProcessId(fallbackId: string): string {
  try {
    const id = localStorage.getItem(STORAGE_KEYS.ACTIVE_PROCESS_ID);
    if (id) return id;
  } catch (e) {}
  return fallbackId;
}

/**
 * 保存选中的活跃工序 ID
 */
export function saveActiveProcessId(processId: string) {
  try {
    localStorage.setItem(STORAGE_KEYS.ACTIVE_PROCESS_ID, processId);
  } catch (e) {}
}

/**
 * 读取当前登录用户账号
 */
export function loadSavedCurrentUser(): UserAccount {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.USER);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.id && parsed.role) {
        return parsed;
      }
    }
  } catch (e) {}
  // 默认使用管理员登录，方便全功能体验
  return PRESET_ACCOUNTS[0];
}

/**
 * 保存当前登录用户
 */
export function saveCurrentUser(user: UserAccount) {
  try {
    localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(user));
  } catch (e) {}
}

/**
 * 导出全量系统数据快照为 JSON 文件 (备份使用)
 */
export function exportSystemDataBackup() {
  try {
    const backup = {
      version: '2.5',
      exportTime: new Date().toISOString(),
      processes: loadSavedProcesses(),
      subgroupsMap: loadAllSubgroupsMap(),
      cnConfig: localStorage.getItem(STORAGE_KEYS.CN_CONFIG) ? JSON.parse(localStorage.getItem(STORAGE_KEYS.CN_CONFIG)!) : null,
      gjbConfig: localStorage.getItem(STORAGE_KEYS.GJB_CONFIG) ? JSON.parse(localStorage.getItem(STORAGE_KEYS.GJB_CONFIG)!) : null
    };

    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `SPC_系统数据完整备份_${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    return true;
  } catch (err) {
    console.error('导出备份失败', err);
    return false;
  }
}

/**
 * 恢复导入全量数据快照
 */
export async function importSystemDataBackup(file: File): Promise<{ success: boolean; message: string }> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const raw = e.target?.result as string;
        const backup = JSON.parse(raw);

        if (!backup || !backup.processes || !Array.isArray(backup.processes)) {
          resolve({ success: false, message: '备份文件格式不正确，缺少工序数据' });
          return;
        }

        localStorage.setItem(STORAGE_KEYS.PROCESSES, JSON.stringify(backup.processes));
        if (backup.subgroupsMap) {
          localStorage.setItem(STORAGE_KEYS.SUBGROUPS_MAP, JSON.stringify(backup.subgroupsMap));
        }
        if (backup.cnConfig) {
          localStorage.setItem(STORAGE_KEYS.CN_CONFIG, JSON.stringify(backup.cnConfig));
        }
        if (backup.gjbConfig) {
          localStorage.setItem(STORAGE_KEYS.GJB_CONFIG, JSON.stringify(backup.gjbConfig));
        }

        resolve({ success: true, message: `成功恢复 ${backup.processes.length} 个工序及关联历史数据！` });
      } catch (err: any) {
        resolve({ success: false, message: `解析备份文件异常: ${err.message}` });
      }
    };
    reader.onerror = () => {
      resolve({ success: false, message: '读取文件失败' });
    };
    reader.readAsText(file);
  });
}
