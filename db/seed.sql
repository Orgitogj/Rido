INSERT INTO mobility.demo_drivers
  (id, first_name, last_name, profile_image_url, car_image_url, car_seats, rating, fare_multiplier_bp)
VALUES
  (1, 'James', 'Wilson', NULL, NULL, 4, 4.8, 10000),
  (2, 'David', 'Brown', NULL, NULL, 5, 4.6, 11500),
  (3, 'Michael', 'Johnson', NULL, NULL, 4, 4.7, 10000),
  (4, 'Robert', 'Green', NULL, NULL, 6, 4.9, 13000)
ON CONFLICT (id) DO NOTHING;
