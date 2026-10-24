// 功能登錄表：所有功能在這裡登記一行。新功能＝新增一個資料夾＋在這裡 import。
import existing from './existing.js';
import canopy_debt from './canopy-debt/index.js';
import mayor_dash from './mayor-dash/index.js';
import shade_equity from './shade-equity/index.js';
import canopy_ledger from './canopy-ledger/index.js';
import conflict_alert from './conflict-alert/index.js';
import vendor_record from './vendor-record/index.js';
import commitments from './commitments/index.js';
import opinion_hotspot from './opinion-hotspot/index.js';
import jurisdiction from './jurisdiction/index.js';
import open_fields from './open-fields/index.js';
import ped_exposure from './ped-exposure/index.js';
import esg_report from './esg-report/index.js';
import dongmen_block from './dongmen-block/index.js';
import tree_diff from './tree-diff/index.js';
import adopt_proposal from './adopt-proposal/index.js';
import wish_map from './wish-map/index.js';

export const FEATURES = [...existing, canopy_debt, mayor_dash, shade_equity, canopy_ledger, conflict_alert, vendor_record, commitments, opinion_hotspot, jurisdiction, open_fields, ped_exposure, esg_report, dongmen_block, tree_diff, adopt_proposal, wish_map];

// 功能組合預設：網址 ?preset=demo，或改這裡一行決定正式網址預設開哪些
export const PRESETS = {
  demo: null, // null＝所有 ready 的功能
  minimal: ['citizen-report', 'planting', 'vendor-check', 'gov-dash', 'records', 'cases'],
};
