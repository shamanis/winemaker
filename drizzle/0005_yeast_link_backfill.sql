-- Инвариант «ровно один способ»: дрожжи партии — только ссылка на штамм
-- справочника. Рукописные записи (strain_id IS NULL) получают запись в
-- справочнике (если штамма с таким именем ещё нет) и ссылку на него.
INSERT INTO `yeast_strains` (`id`, `name`, `producer`, `temp_min_c`, `temp_max_c`, `alcohol_tolerance_pct`, `notes`, `created_at_utc`, `updated_at_utc`)
SELECT lower(hex(randomblob(16))),
       y.`strain_name`,
       y.`producer`,
       NULL,
       NULL,
       NULL,
       'Создан автоматически из записи партии',
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM `batch_yeast` y
WHERE y.`strain_id` IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM `yeast_strains` s WHERE lower(s.`name`) = lower(y.`strain_name`)
  );
--> statement-breakpoint
UPDATE `batch_yeast`
SET `strain_id` = (
  SELECT s.`id` FROM `yeast_strains` s WHERE lower(s.`name`) = lower(`batch_yeast`.`strain_name`)
)
WHERE `strain_id` IS NULL;
