# -*- coding: utf-8 -*-
"""
从抓取产物构建 SQLite 数据库（58moto.db）

背景：
  update_data.js 的 Step 3 会调用 `python3 build_db.py` 建库，但仓库里一直缺少这个文件，
  只能回退到 better-sqlite3 分支；而 better-sqlite3 在部分 Windows 环境缺少预编译的
  原生模块（报 "Could not locate the bindings file"），导致整个流程卡在最后一步。
  本脚本用 Python 标准库 sqlite3 实现，零原生依赖，任何装了 Python 3 的环境都能跑。

输入（由 update_data.js 抓取产生）：
  models_raw_v2.json   车型原始数据（camelCase 字段）
  brand_directory.json 品牌目录（camelCase 字段）

输出：
  58moto.db —— 表结构对齐 export_static.py 的查询
    models: good_id, good_name, series_name, brand_id, brand_name, brand_logo,
            min_price, max_price, good_pic, vehicle_type, energy_label,
            spelling, grade_good_type, sale_status
    brands: brand_id, brand_name, spelling, logo, page_url, has_sale_goods

用法：
  python build_db.py
"""
import json
import os
import sqlite3
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
MODELS_JSON = os.path.join(HERE, 'models_raw_v2.json')
BRANDS_JSON = os.path.join(HERE, 'brand_directory.json')
DB = os.path.join(HERE, '58moto.db')


# ---- gradeGoodType -> 车辆类型（与 update_data.js 的 GRADE_TYPE_MAP 保持一致）----
GRADE_TYPE_MAP = {
    2: '弯梁', 3: '踏板', 4: '巡航太子', 5: '越野',
    8: '街车', 9: '跑车', 10: '旅行', 11: '拉力', 12: '三轮', 15: 'MINI',
}

# ---- 车系名关键词 -> 车辆类型（与 update_data.js 的 SERIES_TYPE_RULES 保持一致）----
SERIES_TYPE_RULES = [
    # 四轮车（ATV/UTV/SSV/全地形车）必须排在「三轮」之前，否则会被吞进三轮
    (['ATV', 'UTV', 'SSV', '全地形车', 'Side by Side', 'SxS', '四轮', '沙滩车', '巴吉',
      '剃刀', 'RZR', 'CFORCE', 'ZFORCE', 'UFORCE'], '四轮车'),
    (['Sea-doo', 'Ski-doo', '雪橇', '摩托艇', '边三轮', '倒三轮', '三轮', 'Spyder'], '三轮'),
    (['踏板', 'ESP系列', 'CoCo', 'Cola', 'MIKU', 'RT踏板', 'ADV踏板', 'MO踏板', '飞雅',
      'PRIMAVERA', 'LX系列', 'GTS', 'DJango', '冠能', '潮玩踏板', '运动踏板', '街道踏板',
      '水冷踏板', '风冷踏板', '小型踏板', '中型踏板', '跨界踏板', '时尚实用', '通勤',
      '龟系列', '龟系', '鹰系列', '鹰系', '牛系列', '巧客', '志界菱蒙踏板', '踏板风韵',
      '飞致', '飞火流星', '钻系列'], '踏板'),
    (['跑车', 'SPORTBIKE', 'Superbike', 'RC跑车', '趴赛跑车', '公路赛车', 'SuperSport',
      'Panigale'], '跑车'),
    (['街车', 'NK系列', 'MT系列', 'Monster', 'Modern现代街车', 'RZ街车', 'Z系列', 'N系列'], '街车'),
    (['复古', 'MODERN CLASSICS', 'Classic', 'RE复古', 'Vintage', '幼狮', 'Vitpilen',
      'Svartpilen', 'Scrambler自游', '自由派', 'Timeless', '先锋复古', '布雷斯通',
      '火眼机甲', '逸系列', '潮派'], '复古'),
    (['巡航', 'Cruiser', 'CRUISER', 'Custom', '太子', '继承者', '运动巡航', 'Diavel',
      'RA巡航', '哈雷', 'Street街道'], '巡航太子'),
    (['拉力', '探险', 'Adventure', 'ADVENTURE', 'Multistrada', 'ADV系列', 'GS系列',
      '拉力越野'], '拉力'),
    (['旅行', 'Touring', 'Bagger', 'Grand American', 'RK旅行', '休旅', '公务车'], '旅行'),
    (['越野', 'Motocross', 'MX系列', 'Enduro', 'ENDURO', '场地车', 'KX系列', 'KLX系列',
      'Scrambler攀爬', 'Supermoto', 'FTR', 'EXC系列', 'FREERIDE', 'Off-Road', '运动家',
      '青少年'], '越野'),
    (['弯梁'], '弯梁'),
    (['迷你', 'MINI', 'U侠'], 'MINI'),
    (['跨骑', '通路', 'KPRO', 'KPM', 'CL系列', '骑士风范', '游侠', 'Rush', '赛系列',
      '鸿系列', 'JY系列', 'W系列', 'S系列', 'A系列', 'X系列', '狼系列', 'N系列', '热销',
      '热门', '运动系列', 'ROADSTERS运动', 'Street系列'], '街车'),
    (['新能源', 'eW15', 'AE系列', '新能源 HYPE', '新能源 S', 'M系列'], '踏板'),
]

ENERGY_MAP = {1: '燃油', 2: '电动', 3: '电动反充'}


def grade_to_type(g, series_name):
    """与 update_data.js 的 gradeToType() 等价：先按 grade 映射，再按车系关键词推断。"""
    if g not in (None, ''):
        try:
            t = GRADE_TYPE_MAP.get(int(g))
            if t:
                return t
        except (TypeError, ValueError):
            pass
    sn = series_name or ''
    for keywords, vtype in SERIES_TYPE_RULES:
        for kw in keywords:
            if kw in sn:
                return vtype
    return '其他'


def energy_label(e):
    try:
        return ENERGY_MAP.get(int(e), '其他')
    except (TypeError, ValueError):
        return '其他'


def load_json(path):
    if not os.path.exists(path):
        raise SystemExit('缺少输入文件: ' + path + '（请先运行 update_data.js 完成抓取）')
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)


def as_list(data, *keys):
    """兼容 {models:[...]} / {data:[...]} / [...] 三种结构"""
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        for k in keys:
            if isinstance(data.get(k), list):
                return data[k]
    return []


def main():
    models_raw = as_list(load_json(MODELS_JSON), 'models', 'data')
    brands_raw = as_list(load_json(BRANDS_JSON), 'brands', 'data')

    if not models_raw:
        raise SystemExit('models_raw_v2.json 为空，抓取可能失败，已中止以免覆盖旧库')

    # 保险：车型数过少通常意味着抓取不完整，避免用残缺数据覆盖线上已有数据
    if len(models_raw) < 1000:
        raise SystemExit(
            '车型数仅 %d，疑似抓取不完整（阈值 1000），已中止' % len(models_raw)
        )

    if os.path.exists(DB):
        os.remove(DB)

    conn = sqlite3.connect(DB)
    cur = conn.cursor()

    cur.execute('''
        CREATE TABLE models (
            good_id TEXT PRIMARY KEY,
            good_name TEXT,
            series_name TEXT,
            brand_id TEXT,
            brand_name TEXT,
            brand_logo TEXT,
            min_price TEXT,
            max_price TEXT,
            good_pic TEXT,
            vehicle_type TEXT,
            energy_label TEXT,
            spelling TEXT,
            grade_good_type TEXT,
            sale_status TEXT
        )
    ''')
    cur.execute('''
        CREATE TABLE brands (
            brand_id TEXT PRIMARY KEY,
            brand_name TEXT,
            spelling TEXT,
            logo TEXT,
            page_url TEXT,
            has_sale_goods TEXT
        )
    ''')

    # 车型：camelCase -> snake_case
    rows = []
    for m in models_raw:
        rows.append((
            str(m.get('goodId', '') or ''),
            m.get('goodName', '') or '',
            m.get('seriesName', '') or '',
            str(m.get('brandId', '') or ''),
            m.get('brandName', '') or '',
            m.get('brandLogo', '') or '',
            m.get('minPrice', '') or '',
            m.get('maxPrice', '') or '',
            m.get('goodPic', '') or '',
            # vehicle_type 必须输出中文标签（前端 TYPES 是中文），不能写原始数字代码
            grade_to_type(m.get('gradeGoodType'), m.get('seriesName')),
            energy_label(m.get('energyType')),
            m.get('spelling', '') or '',
            m.get('gradeGoodType', '') or '',
            m.get('saleStatus', '') or '',
        ))
    cur.executemany(
        'INSERT OR REPLACE INTO models VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', rows
    )

    brows = []
    for b in brands_raw:
        brows.append((
            str(b.get('brandId', '') or ''),
            b.get('brandName', '') or '',
            b.get('spelling', '') or '',
            b.get('logo', '') or '',
            b.get('url', '') or '',
            b.get('existSaleGoods', '') or '',
        ))
    cur.executemany('INSERT OR REPLACE INTO brands VALUES (?,?,?,?,?,?)', brows)

    conn.commit()
    conn.close()

    # update_data.js 的 buildDb() 靠这行标记判断 Python 方案是否成功，缺了会误退到 better-sqlite3
    print('DB_BUILD_OK models=%d brands=%d' % (len(rows), len(brows)))
    print('建库完成 -> %s' % DB)
    print('  models: %d 条' % len(rows))
    print('  brands: %d 条' % len(brows))


if __name__ == '__main__':
    try:
        main()
    except SystemExit:
        raise
    except Exception as e:
        print('PIPELINE_ERROR: ' + str(e), file=sys.stderr)
        sys.exit(1)
