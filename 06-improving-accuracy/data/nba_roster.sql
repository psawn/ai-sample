-- =======================================================================
-- BẢNG nba_roster: DỮ LIỆU MẪU CHO 02-sql-agent.js
-- Chạy lại được: bảng cũ bị xóa rồi tạo lại.
--
-- Dữ liệu mẫu ít dòng, chỉ để học. Lương lấy gần đúng mùa 2023-24, không chính xác tuyệt đối.
--
-- Cố ý để dữ liệu "bẩn" để thử xem model có xử lý được không:
-- - salary là CHỮ: "$9,945,830", rỗng thì "--"
-- - college rỗng thì "--", jersey rỗng thì "NA"
-- - Sắp xếp salary theo chữ (ORDER BY salary DESC) thì sai thứ tự:
--   "--" đứng đầu (Javon Freeman-Liberty), rồi "$9,945,830" (Otto Porter Jr.) vì '9' > '5',
--   Stephen Curry ("$51,915,615", lương cao nhất thật) chỉ đứng thứ 4
-- Tên cột chữ thường: Postgres tự hạ chữ thường tên không có ngoặc kép -> model viết NAME hay name đều chạy.
-- Trong chuỗi SQL, dấu ' viết thành '' (VD 6'' 2" = 6' 2")
-- =======================================================================

DROP TABLE IF EXISTS nba_roster;

CREATE TABLE nba_roster (
  team    TEXT,
  name    TEXT,
  jersey  TEXT,
  pos     TEXT,
  age     INTEGER,
  ht      TEXT,
  wt      TEXT,
  college TEXT,
  salary  TEXT
);

INSERT INTO nba_roster (team, name, jersey, pos, age, ht, wt, college, salary) VALUES
  ('Golden State Warriors',  'Stephen Curry',           '30', 'PG', 35, '6'' 2"',  '185 lbs', 'Davidson',      '$51,915,615'),
  ('Golden State Warriors',  'Brandin Podziemski',      '2',  'SG', 21, '6'' 5"',  '205 lbs', 'Santa Clara',   '$3,487,920'),
  ('Phoenix Suns',           'Kevin Durant',            '35', 'PF', 35, '6'' 10"', '240 lbs', 'Texas',         '$47,649,433'),
  ('Los Angeles Lakers',     'LeBron James',            '23', 'SF', 39, '6'' 9"',  '250 lbs', '--',            '$47,607,350'),
  ('Denver Nuggets',         'Nikola Jokic',            '15', 'C',  29, '6'' 11"', '284 lbs', '--',            '$47,607,350'),
  ('Milwaukee Bucks',        'Giannis Antetokounmpo',   '34', 'PF', 29, '6'' 11"', '243 lbs', '--',            '$45,640,084'),
  ('Miami Heat',             'Jimmy Butler',            '22', 'SF', 34, '6'' 7"',  '230 lbs', 'Marquette',     '$45,183,960'),
  ('Dallas Mavericks',       'Luka Doncic',             '77', 'PG', 25, '6'' 7"',  '230 lbs', '--',            '$40,064,220'),
  ('Oklahoma City Thunder',  'Shai Gilgeous-Alexander', '2',  'PG', 25, '6'' 6"',  '195 lbs', 'Kentucky',      '$33,386,850'),
  ('Boston Celtics',         'Jayson Tatum',            '0',  'SF', 26, '6'' 8"',  '210 lbs', 'Duke',          '$32,600,060'),
  ('Minnesota Timberwolves', 'Anthony Edwards',         '5',  'SG', 22, '6'' 4"',  '225 lbs', 'Georgia',       '$13,534,817'),
  ('San Antonio Spurs',      'Victor Wembanyama',       '1',  'C',  20, '7'' 4"',  '210 lbs', '--',            '$12,160,800'),
  ('Toronto Raptors',        'Otto Porter Jr.',         '32', 'PF', 30, '6'' 8"',  '198 lbs', 'Georgetown',    '$9,945,830'),
  ('Toronto Raptors',        'Scottie Barnes',          '4',  'SF', 22, '6'' 7"',  '237 lbs', 'Florida State', '$8,008,560'),
  ('Toronto Raptors',        'Javon Freeman-Liberty',   'NA', 'SG', 24, '6'' 3"',  '180 lbs', 'DePaul',        '--');
