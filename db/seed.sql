INSERT INTO mobility.demo_drivers
  (id, first_name, last_name, profile_image_url, car_image_url, car_seats, rating, fare_multiplier_bp)
VALUES
  (1, 'James', 'Wilson', NULL, NULL, 4, 4.8, 10000),
  (2, 'David', 'Brown', NULL, NULL, 5, 4.6, 11500),
  (3, 'Michael', 'Johnson', NULL, NULL, 4, 4.7, 10000),
  (4, 'Robert', 'Green', NULL, NULL, 6, 4.9, 13000)
ON CONFLICT (id) DO NOTHING;

WITH area AS (
  INSERT INTO mobility.service_areas
    (code, name, status, boundary, min_latitude, max_latitude, min_longitude,
     max_longitude, dropoff_rule, is_development, created_at, updated_at)
  VALUES (
    'dev-example-sf',
    'Development example only (downtown San Francisco test area, not a launch area)',
    'active',
    '[[37.755, -122.44], [37.755, -122.385], [37.81, -122.385], [37.81, -122.44]]',
    37.755, 37.81, -122.44, -122.385,
    'inside_area', true, now(), now())
  ON CONFLICT (code) DO NOTHING
  RETURNING id
)
INSERT INTO mobility.fare_policies
  (service_area_id, version, label, is_development, base_cents, per_km_cents,
   per_minute_cents, minimum_fare_cents, effective_from, reason, created_at)
SELECT id, 1, 'Development policy (placeholder rates, not commercial prices)', true,
       250, 120, 30, 500, '2020-01-01T00:00:00Z',
       'Seeded development example. Replace with your own area and rates in the operations console.',
       now()
  FROM area;

INSERT INTO mobility.service_area_events (service_area_id, actor, action, reason, snapshot, created_at)
SELECT a.id, 'system', 'seeded_development_example',
       'Development seed only', jsonb_build_object('code', a.code), now()
  FROM mobility.service_areas a
 WHERE a.code = 'dev-example-sf'
   AND NOT EXISTS (SELECT 1 FROM mobility.service_area_events e WHERE e.service_area_id = a.id);