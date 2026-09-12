import sqlite3, json, re, io, os, datetime

STATIC = os.path.dirname(os.path.abspath(__file__))
WS = os.path.dirname(STATIC)
DB = os.path.join(STATIC, '58moto.db')
if not os.path.exists(DB):
    DB = os.path.join(WS, '58moto.db')
OUT = os.path.join(STATIC, 'data.json')

os.makedirs(STATIC, exist_ok=True)


def extract_disp(name):
    """从车型名提取排量(cc)，仅接受 50-2000，否则 None。"""
    if not name:
        return None
    m = re.search(r'(\d{3,4})\s*(?:cc|ml|CC|ML)?', name or '')
    if not m:
        return None
    v = int(m.group(1))
    return v if 50 <= v <= 2000 else None


def main():
    if not os.path.exists(DB):
        raise SystemExit('找不到数据库: ' + DB + ' （请先运行 update_data.js 建库）')
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    models = []
    for r in conn.execute(
        "SELECT good_id,good_name,series_name,brand_id,brand_name,brand_logo,"
        "min_price,max_price,good_pic,vehicle_type,energy_label,spelling,"
        "grade_good_type,sale_status FROM models"
    ):
        d = dict(r)
        d['disp'] = extract_disp(d['good_name'])
        models.append(d)
    brands = [dict(r) for r in conn.execute(
        "SELECT brand_id,brand_name,spelling,logo,page_url,has_sale_goods FROM brands"
    )]
    conn.close()

    data = {
        'generated_at': datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ'),
        'source': '58moto.com',
        'total_models': len(models),
        'total_brands': len(brands),
        'models': models,
        'brands': brands,
    }
    with io.open(OUT, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
    print('exported', len(models), 'models,', len(brands), 'brands ->', OUT)


if __name__ == '__main__':
    main()
