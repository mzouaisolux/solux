-- Sample catalog for local testing.

insert into products (id, name, category, base_price, image_url) values
  ('11111111-1111-1111-1111-111111111111', 'SOLUX Street 60W', 'Street lighting', 180, 'https://placehold.co/320x220?text=Street+60W'),
  ('22222222-2222-2222-2222-222222222222', 'SOLUX Garden 20W', 'Garden lighting', 95, 'https://placehold.co/320x220?text=Garden+20W');

insert into options (product_id, option_type, option_value, price_modifier) values
  ('11111111-1111-1111-1111-111111111111', 'CCT', '3000K', 0),
  ('11111111-1111-1111-1111-111111111111', 'CCT', '4000K', 0),
  ('11111111-1111-1111-1111-111111111111', 'CCT', '5700K', 5),
  ('11111111-1111-1111-1111-111111111111', 'Bracket', 'None', 0),
  ('11111111-1111-1111-1111-111111111111', 'Bracket', 'Single arm', 15),
  ('11111111-1111-1111-1111-111111111111', 'Bracket', 'Double arm', 28),
  ('11111111-1111-1111-1111-111111111111', 'Pole diameter', '60mm', 0),
  ('11111111-1111-1111-1111-111111111111', 'Pole diameter', '76mm', 4),
  ('22222222-2222-2222-2222-222222222222', 'CCT', '3000K', 0),
  ('22222222-2222-2222-2222-222222222222', 'CCT', '4000K', 0),
  ('22222222-2222-2222-2222-222222222222', 'Bracket', 'Wall mount', 6),
  ('22222222-2222-2222-2222-222222222222', 'Bracket', 'Ground stake', 3);

insert into prices_version (product_id, price, valid_from) values
  ('11111111-1111-1111-1111-111111111111', 180, current_date),
  ('22222222-2222-2222-2222-222222222222', 95, current_date);
