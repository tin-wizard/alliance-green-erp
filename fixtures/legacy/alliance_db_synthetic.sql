-- MySQL dump 10.13  Distrib 5.7.44, for Linux (x86_64)
--
-- Host: localhost    Database: alliance_db
-- ------------------------------------------------------
-- Server version	5.7.44
--
-- Synthetic fixture for the migration rehearsal. Shapes are real (every column,
-- every table in the load manifest); values are fabricated. Encoded latin1 to match
-- the client dump command in the cutover plan (section 10 of the harness spec).
--
-- Table order follows the import manifest, not mysqldump's alphabetical order, so
-- a reader can walk the file top to bottom. Dated duplicate copies are appended
-- last: they must be seen and skipped, never loaded.

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES latin1 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;


--
-- Table structure for table `wo_status`
--

DROP TABLE IF EXISTS `wo_status`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `wo_status` (
  `id` tinyint(1) NOT NULL AUTO_INCREMENT,
  `name` varchar(25) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `wo_status`
--

/*!40000 ALTER TABLE `wo_status` DISABLE KEYS */;
INSERT INTO `wo_status` VALUES (1,'Open'),(2,'In Progress'),(3,'Complete'),(4,'Cancelled'),(5,'On Hold');
/*!40000 ALTER TABLE `wo_status` ENABLE KEYS */;


--
-- Table structure for table `wo_priority`
--

DROP TABLE IF EXISTS `wo_priority`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `wo_priority` (
  `id` tinyint(1) NOT NULL AUTO_INCREMENT,
  `name` varchar(40) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `wo_priority`
--

/*!40000 ALTER TABLE `wo_priority` DISABLE KEYS */;
INSERT INTO `wo_priority` VALUES (1,'Low'),(2,'Medium'),(3,'High');
/*!40000 ALTER TABLE `wo_priority` ENABLE KEYS */;


--
-- Table structure for table `wo_servtype`
--

DROP TABLE IF EXISTS `wo_servtype`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `wo_servtype` (
  `id` tinyint(1) NOT NULL AUTO_INCREMENT,
  `name` varchar(20) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `wo_servtype`
--

/*!40000 ALTER TABLE `wo_servtype` DISABLE KEYS */;
INSERT INTO `wo_servtype` VALUES (1,'Service Call'),(2,'Project'),(3,'Maintenance'),(4,'Emergency');
/*!40000 ALTER TABLE `wo_servtype` ENABLE KEYS */;


--
-- Table structure for table `wo_categories`
--

DROP TABLE IF EXISTS `wo_categories`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `wo_categories` (
  `id` tinyint(1) NOT NULL AUTO_INCREMENT,
  `code` varchar(25) DEFAULT NULL,
  `name` varchar(25) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `wo_categories`
--

/*!40000 ALTER TABLE `wo_categories` DISABLE KEYS */;
INSERT INTO `wo_categories` VALUES (1,'ELEC','Electrical'),(2,'LIGHT','Lighting'),(3,'MECH','Mechanical'),(4,NULL,'Signage');
/*!40000 ALTER TABLE `wo_categories` ENABLE KEYS */;


--
-- Table structure for table `po_status`
--

DROP TABLE IF EXISTS `po_status`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `po_status` (
  `id` tinyint(1) NOT NULL AUTO_INCREMENT,
  `name` varchar(25) NOT NULL,
  `sorting_order` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `po_status`
--

/*!40000 ALTER TABLE `po_status` DISABLE KEYS */;
INSERT INTO `po_status` VALUES (1,'Draft',1),(2,'Submitted',2),(3,'Approved',3),(4,'Ordered',4),(5,'Received',5),(6,'Cancelled',6);
/*!40000 ALTER TABLE `po_status` ENABLE KEYS */;


--
-- Table structure for table `po_priority`
--

DROP TABLE IF EXISTS `po_priority`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `po_priority` (
  `id` tinyint(1) NOT NULL AUTO_INCREMENT,
  `name` varchar(40) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `po_priority`
--

/*!40000 ALTER TABLE `po_priority` DISABLE KEYS */;
INSERT INTO `po_priority` VALUES (1,'Low'),(2,'Medium'),(3,'High');
/*!40000 ALTER TABLE `po_priority` ENABLE KEYS */;


--
-- Table structure for table `po_preorder_status`
--

DROP TABLE IF EXISTS `po_preorder_status`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `po_preorder_status` (
  `id` tinyint(1) NOT NULL AUTO_INCREMENT,
  `name` varchar(25) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `po_preorder_status`
--

/*!40000 ALTER TABLE `po_preorder_status` DISABLE KEYS */;
INSERT INTO `po_preorder_status` VALUES (1,'New'),(2,'Quoted'),(3,'Converted');
/*!40000 ALTER TABLE `po_preorder_status` ENABLE KEYS */;


--
-- Table structure for table `customer_quote_status`
--

DROP TABLE IF EXISTS `customer_quote_status`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `customer_quote_status` (
  `id` tinyint(1) NOT NULL AUTO_INCREMENT,
  `name` varchar(25) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `customer_quote_status`
--

/*!40000 ALTER TABLE `customer_quote_status` DISABLE KEYS */;
INSERT INTO `customer_quote_status` VALUES (1,'Draft'),(2,'Sent'),(3,'Approved'),(4,'Rejected');
/*!40000 ALTER TABLE `customer_quote_status` ENABLE KEYS */;


--
-- Table structure for table `standalone_quote_status`
--

DROP TABLE IF EXISTS `standalone_quote_status`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `standalone_quote_status` (
  `id` tinyint(1) NOT NULL AUTO_INCREMENT,
  `name` varchar(25) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `standalone_quote_status`
--

/*!40000 ALTER TABLE `standalone_quote_status` DISABLE KEYS */;
INSERT INTO `standalone_quote_status` VALUES (1,'Draft'),(2,'Sent'),(3,'Approved'),(4,'Rejected');
/*!40000 ALTER TABLE `standalone_quote_status` ENABLE KEYS */;


--
-- Table structure for table `tjx_quote_status`
--

DROP TABLE IF EXISTS `tjx_quote_status`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `tjx_quote_status` (
  `id` tinyint(1) NOT NULL AUTO_INCREMENT,
  `name` varchar(25) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `tjx_quote_status`
--

/*!40000 ALTER TABLE `tjx_quote_status` DISABLE KEYS */;
INSERT INTO `tjx_quote_status` VALUES (1,'Draft'),(2,'Sent'),(3,'Approved'),(4,'Rejected');
/*!40000 ALTER TABLE `tjx_quote_status` ENABLE KEYS */;


--
-- Table structure for table `rga_status`
--

DROP TABLE IF EXISTS `rga_status`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `rga_status` (
  `id` tinyint(1) NOT NULL AUTO_INCREMENT,
  `name` varchar(25) NOT NULL,
  `sorting_order` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `rga_status`
--

/*!40000 ALTER TABLE `rga_status` DISABLE KEYS */;
INSERT INTO `rga_status` VALUES (1,'Requested',1),(2,'Shipped',2),(3,'Received',3),(4,'Closed',NULL);
/*!40000 ALTER TABLE `rga_status` ENABLE KEYS */;


--
-- Table structure for table `customer`
--

DROP TABLE IF EXISTS `customer`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `customer` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(1000) DEFAULT NULL,
  `street` varchar(200) DEFAULT NULL,
  `city` varchar(50) DEFAULT NULL,
  `province` varchar(25) DEFAULT NULL,
  `postalcode` varchar(20) DEFAULT NULL,
  `cname` varchar(250) DEFAULT NULL,
  `cnumber` varchar(25) DEFAULT NULL,
  `cemail1` varchar(50) DEFAULT NULL,
  `salesp` varchar(50) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `customer`
--

/*!40000 ALTER TABLE `customer` DISABLE KEYS */;
INSERT INTO `customer` VALUES (1,'Alliance Lighting Inc.','12 King St W','Toronto','ON','M5H 2N2','Marc Tremblay','416-555-0110','service@alliancelighting.ca','Derek Chan'),(2,'CLS Green Systems','455 Front St E','Montréal','QC','H2R 2W3','Sophie Dubé','514-555-0198','dispatch@clsgreen.com','Marc Tremblay'),(3,'L\'Alliance Café ô Ça','3400 Rue Jean-Talon E','Montréal','QC','H2R 2W3','Luc Côté','514-555-0142','comptes@cafenord.ca','Sophie Dubé'),(4,'Hydro One Networks','100 Consilium Pl','Toronto','ON','M5H 2N2','Priya Raman','416-555-0177','billing@duval.qc.ca','Derek Chan'),(5,'Café Nord \"Centre\"','750 Boulevard Industriel','Laval','QC','H2R 2W3','Hélène Girard','514-555-0123','ops@cafenord.ca','Marc Tremblay'),(6,'Équipement Duval Ltée','5650 Rue Hochelaga','Montréal','QC','H2R 2W3','André Combes','514-555-0110','atelier@duval.qc.ca','Sophie Dubé');
/*!40000 ALTER TABLE `customer` ENABLE KEYS */;


--
-- Table structure for table `sites`
--

DROP TABLE IF EXISTS `sites`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `sites` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `custid` int(10) unsigned NOT NULL,
  `name` varchar(100) NOT NULL,
  `street` varchar(200) NOT NULL,
  `street_2` text DEFAULT NULL,
  `city` varchar(50) NOT NULL,
  `province` varchar(25) NOT NULL,
  `postalcode` varchar(25) DEFAULT NULL,
  `cname` varchar(200) DEFAULT NULL,
  `cnumber` varchar(25) DEFAULT NULL,
  `warranty` tinyint(1) DEFAULT NULL,
  `warranty_exp` date DEFAULT NULL,
  `warranty_notes` mediumtext DEFAULT NULL,
  `notes` mediumtext DEFAULT NULL,
  `dns` varchar(10) DEFAULT NULL,
  `lift` varchar(10) DEFAULT NULL,
  `mall` varchar(100) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `sites`
--

/*!40000 ALTER TABLE `sites` DISABLE KEYS */;
INSERT INTO `sites` VALUES (1,1,'Alliance - Distribution Centre','88 Queens Quay W','Suite 200','Toronto','AB','H2R 2W3','Bill Okafor','905-555-0142',1,NULL,'Emergency circuit tested and tagged; report signed by site contact.','Commande reçue partielle, reste 2 unités en reliquat.','internal','L1','Maintenance'),(2,1,'Alliance - Scarborough','88 Queens Quay W',NULL,'Scarborough','ON','H2R 2W3','Jocelyn Roy','204-555-0123',2,'2025-03-02','Customer approved the repair by email; completion photo attached.','Dock door code 4411.\nKey at security desk.',NULL,NULL,'Pending'),(3,2,'CLS - Head Office','455 Front St E',NULL,'Toronto','ON','K1P 1J1','Ana Ferreira','416-555-0110',3,'2025-03-03','Luminaire extérieur remplacé, façade ô côté cour.','Commande reçue partielle, reste 2 unités en reliquat.','','L3','CLS'),(4,3,'Café Nord - Plateau','3400 Rue Jean-Talon E','Suite 200','Montréal','ON','L4W 1J7','Bill Okafor',NULL,4,'2025-03-04','Luminaire extérieur remplacé, façade ô côté cour.',NULL,'external','L4','Alliance'),(5,4,'Hydro One - Sudbury Depot','12 King St W',NULL,'Sudbury','BC','H2R 2W3','Ana Ferreira','416-555-0110',5,'0000-00-00','Vérifier le câblage et la boîte de jonction avant la prochaine visite.','Luminaire extérieur remplacé, façade ô côté cour.','internal','L5','CLS'),(6,5,'Café Nord - Laval','5650 Rue Hochelaga',NULL,'Laval','MB','L4W 1J7',NULL,'613-555-0177',6,'2025-03-06','Commande reçue partielle, reste 2 unités en reliquat.','Emergency circuit tested and tagged; report signed by site contact.','external','L6','North'),(7,9001,'Legacy Site A (no billing customer)','750 Boulevard Industriel','Suite 200','Ottawa','AB','L4W 1J7','Derek Chan','514-555-0198',7,'2025-03-07','Replaced driver and verified output on all four fixtures.','','internal','','Completed'),(8,9002,'Legacy Site B (no billing customer)','100 Consilium Pl',NULL,'Winnipeg','AB','H2R 2W3','Priya Raman','',8,'2025-03-08','Customer approved the repair by email; completion photo attached.','Luminaire extérieur remplacé, façade ô côté cour.','external','L8','Pending');
/*!40000 ALTER TABLE `sites` ENABLE KEYS */;


--
-- Table structure for table `subcontractor`
--

DROP TABLE IF EXISTS `subcontractor`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `subcontractor` (
  `id` int(11) unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(75) NOT NULL,
  `street` varchar(200) NOT NULL,
  `city` varchar(50) NOT NULL,
  `province` varchar(25) NOT NULL,
  `postalcode` varchar(25) NOT NULL,
  `cname` varchar(250) NOT NULL,
  `cnumber` varchar(50) NOT NULL,
  `cemail1` varchar(50) NOT NULL,
  `cemail2` varchar(50) DEFAULT NULL,
  `cemail3` varchar(50) DEFAULT NULL,
  `interior` decimal(7,2) DEFAULT NULL,
  `exterior` decimal(7,2) DEFAULT NULL,
  `other` decimal(7,2) DEFAULT NULL,
  `stock_notification_alert_type` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `subcontractor`
--

/*!40000 ALTER TABLE `subcontractor` DISABLE KEYS */;
INSERT INTO `subcontractor` VALUES (1,'Jocelyn Roy','100 Consilium Pl','Sudbury','AB','K1P 1J1','Jocelyn Roy','416-555-0110','ops@cafenord.ca','service@alliancelighting.ca','accounting@clsgreen.com',1.00,1.00,1.00,1),(2,'Marc Tremblay','88 Queens Quay W','Sudbury','AB','P3C 5R4','Luc Côté','416-555-0110','dispatch@clsgreen.com','dispatch@clsgreen.com','',2.00,2.00,2.00,2),(3,'Priya Raman','455 Front St E','Montréal','AB','L4W 1J7','Derek Chan','514-555-0198','ops@cafenord.ca','ops@cafenord.ca','accounting@clsgreen.com',3.00,3.00,3.00,3),(4,'Bill Okafor','88 Queens Quay W','Sudbury','MB','M5A 1G1','Priya Raman','204-555-0123','dispatch@clsgreen.com','ops@cafenord.ca','accounting@clsgreen.com',4.00,NULL,4.00,4),(5,'Jocelyn Roy','25 Sheppard Ave W','Mississauga','AB','P3C 5R4','Ana Ferreira','514-555-0198','dispatch@clsgreen.com','ops@cafenord.ca','billing@duval.qc.ca',5.00,5.00,5.00,5);
/*!40000 ALTER TABLE `subcontractor` ENABLE KEYS */;


--
-- Table structure for table `subcontractor_contact_info`
--

DROP TABLE IF EXISTS `subcontractor_contact_info`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `subcontractor_contact_info` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `subid` int(11) DEFAULT NULL,
  `contact_name` varchar(60) DEFAULT NULL,
  `phone` varchar(60) DEFAULT NULL,
  `phone_ext` varchar(10) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `subcontractor_contact_info`
--

/*!40000 ALTER TABLE `subcontractor_contact_info` DISABLE KEYS */;
INSERT INTO `subcontractor_contact_info` VALUES (1,1,'Jocelyn Roy','905-555-0142','100'),(2,2,'Jocelyn Roy','416-555-0110','101'),(3,3,NULL,'514-555-0198','102'),(4,4,'Hélène Girard','613-555-0177','103'),(5,5,'Jocelyn Roy','613-555-0177','104');
/*!40000 ALTER TABLE `subcontractor_contact_info` ENABLE KEYS */;


--
-- Table structure for table `suppliers`
--

DROP TABLE IF EXISTS `suppliers`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `suppliers` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `sage_vendor_id` int(11) DEFAULT NULL,
  `name` varchar(50) DEFAULT NULL,
  `address` varchar(100) DEFAULT NULL,
  `city` varchar(80) DEFAULT NULL,
  `province` varchar(80) DEFAULT NULL,
  `postalcode` varchar(80) DEFAULT NULL,
  `additional_emails` text DEFAULT NULL,
  `additional_emails_accounting` text DEFAULT NULL,
  `contact_number` varchar(50) DEFAULT NULL,
  `contact_person` varchar(50) DEFAULT NULL,
  `user_id` int(11) DEFAULT NULL,
  `is_under_cls` int(11) DEFAULT NULL,
  `is_online_vendor` int(11) DEFAULT NULL,
  `popnotes` text DEFAULT NULL,
  `bypass_po_approval` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `suppliers`
--

/*!40000 ALTER TABLE `suppliers` DISABLE KEYS */;
INSERT INTO `suppliers` VALUES (1,1,'Oxford Properties','Alliance','Winnipeg','ON','L4W 1J7','service@alliancelighting.ca','Replaced driver and verified output on all four fixtures.','416-555-0110','Tridel Corporation',1,1,1,'Customer approved the repair by email; completion photo attached.',1),(2,2,'Menkes Developments','Scheduled','Toronto','MB','M5H 2N2','dispatch@clsgreen.com','Emergency circuit tested and tagged; report signed by site contact.','905-555-0142','Café Nord Éclairage',2,2,2,'Vérifier le câblage et la boîte de jonction avant la prochaine visite.',2),(3,3,'Tridel Corporation','North','Winnipeg','QC','H2R 2W3',NULL,'Customer approved the repair by email; completion photo attached.','416-555-0110','',3,3,3,'Luminaire extérieur remplacé, façade ô côté cour.',3),(4,4,'Menkes Developments','Scheduled',NULL,'ON','P3C 5R4','dispatch@clsgreen.com','Replaced driver and verified output on all four fixtures.','204-555-0123','Équipement Duval Ltée',4,NULL,4,'Vérifier le câblage et la boîte de jonction avant la prochaine visite.',4);
/*!40000 ALTER TABLE `suppliers` ENABLE KEYS */;


--
-- Table structure for table `customer_emails`
--

DROP TABLE IF EXISTS `customer_emails`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `customer_emails` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `email` varchar(200) DEFAULT NULL,
  `name` varchar(50) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `customer_emails`
--

/*!40000 ALTER TABLE `customer_emails` DISABLE KEYS */;
INSERT INTO `customer_emails` VALUES (1,'accounting@clsgreen.com','Derek Chan'),(2,'ops@cafenord.ca','Luc Côté'),(3,'accounting@clsgreen.com','Hélène Girard'),(4,'service@alliancelighting.ca','Marc Tremblay');
/*!40000 ALTER TABLE `customer_emails` ENABLE KEYS */;


--
-- Table structure for table `site_address_change_log`
--

DROP TABLE IF EXISTS `site_address_change_log`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `site_address_change_log` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `site_id` int(11) DEFAULT NULL,
  `sage_address` text DEFAULT NULL,
  `portal_address` text DEFAULT NULL,
  `keep_warranty` varchar(10) DEFAULT NULL,
  `log_date` date DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `site_address_change_log`
--

/*!40000 ALTER TABLE `site_address_change_log` DISABLE KEYS */;
INSERT INTO `site_address_change_log` VALUES (1,1,'Customer approved the repair by email; completion photo attached.','Replaced driver and verified output on all four fixtures.','1','2025-03-01'),(2,2,'Luminaire extérieur remplacé, façade ô côté cour.','Luminaire extérieur remplacé, façade ô côté cour.','0','2025-03-02'),(3,3,'Customer approved the repair by email; completion photo attached.',NULL,'1','2025-03-03');
/*!40000 ALTER TABLE `site_address_change_log` ENABLE KEYS */;


--
-- Table structure for table `users`
--

DROP TABLE IF EXISTS `users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `users` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `username` varchar(32) NOT NULL,
  `password` varchar(32) NOT NULL,
  `email` varchar(50) NOT NULL,
  `access` tinyint(1) NOT NULL,
  `subid` int(11) DEFAULT NULL,
  `phone` varchar(25) DEFAULT NULL,
  `phone2` varchar(50) DEFAULT NULL,
  `phone2_ext` varchar(10) DEFAULT NULL,
  `email2` varchar(100) DEFAULT NULL,
  `full_name` text DEFAULT NULL,
  `mailing_user` varchar(100) DEFAULT NULL,
  `mailing_password` varchar(250) DEFAULT NULL,
  `cls_mailing_user` text DEFAULT NULL,
  `cls_mailing_password` text DEFAULT NULL,
  `user_addworkorder_without_wsib` int(11) DEFAULT NULL,
  `is_enabled` int(11) DEFAULT NULL,
  `department_type` varchar(15) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `users`
--

/*!40000 ALTER TABLE `users` DISABLE KEYS */;
INSERT INTO `users` VALUES (1,'jsmith','5f4dcc3b5aa765d61d8327deb882cf99','jsmith@clsgreen.com',1,1,'204-555-0123','416-555-0110','100','Standard','Jason Smith',NULL,'Maintenance','Vérifier le câblage et la boîte de jonction avant la prochaine visite.','Emergency circuit tested and tagged; report signed by site contact.',1,1,'Office'),(2,'jsmith','5f4dcc3b5aa765d61d8327deb882cf99','j.smith@clsgreen.com',1,1,NULL,'416-555-0110','101','Interior','J. Smith (dispatch)','Standard','Completed','Vérifier le câblage et la boîte de jonction avant la prochaine visite.','Replaced driver and verified output on all four fixtures.',2,1,'Office'),(3,'mchen','5f4dcc3b5aa765d61d8327deb882cf99','mchen@clsgreen.com',1,2,'204-555-0123','905-555-0142','102','Completed','Mei Chen',NULL,'Completed','Replaced driver and verified output on all four fixtures.','Emergency circuit tested and tagged; report signed by site contact.',3,0,'Accounting'),(4,'rpatel','5f4dcc3b5aa765d61d8327deb882cf99','rpatel@clsgreen.com',0,3,'514-555-0198','514-555-0198','103','Standard','Raj Patel',NULL,'Maintenance','Commande reçue partielle, reste 2 unités en reliquat.','Vérifier le câblage et la boîte de jonction avant la prochaine visite.',4,0,'Technician'),(5,'tgarcia','5f4dcc3b5aa765d61d8327deb882cf99','tgarcia@clsgreen.com',0,4,NULL,'905-555-0142','104','Completed','Tomás García','Completed','Completed',NULL,'Commande reçue partielle, reste 2 unités en reliquat.',5,0,'Technician'),(6,'dnguyen','5f4dcc3b5aa765d61d8327deb882cf99','dnguyen@clsgreen.com',0,99,'905-555-0142','613-555-0177','105','Alliance','Duc Nguyen','CLS','Completed','Luminaire extérieur remplacé, façade ô côté cour.','Commande reçue partielle, reste 2 unités en reliquat.',6,1,'Subcontractor'),(7,'kwilliams','5f4dcc3b5aa765d61d8327deb882cf99','',1,5,'416-555-0110','514-555-0198','106','Completed','Kim Williams','CLS','Scheduled','Vérifier le câblage et la boîte de jonction avant la prochaine visite.','Emergency circuit tested and tagged; report signed by site contact.',7,1,'Office'),(8,'info','5f4dcc3b5aa765d61d8327deb882cf99','info@clsgreen.com',1,3,'613-555-0177','613-555-0177','107','Standard','Shared Info Mailbox','Scheduled','Pending','Vérifier le câblage et la boîte de jonction avant la prochaine visite.','Emergency circuit tested and tagged; report signed by site contact.',8,1,'Office'),(9,'accounting','5f4dcc3b5aa765d61d8327deb882cf99','info@clsgreen.com',1,4,'416-555-0110','416-555-0110','108','Completed','Shared Accounting Mailbox','CLS','Maintenance','Replaced driver and verified output on all four fixtures.','Customer approved the repair by email; completion photo attached.',9,1,'Accounting'),(10,'lduval','5f4dcc3b5aa765d61d8327deb882cf99','lduval@duval.qc.ca',1,5,'613-555-0177','905-555-0142','109','Exterior','Luc Duval (électricien)','CLS','Completed','Replaced driver and verified output on all four fixtures.','Luminaire extérieur remplacé, façade ô côté cour.',1,1,'Technician'),(11,'sjones','5f4dcc3b5aa765d61d8327deb882cf99','sjones@clsgreen.com',0,4,NULL,'204-555-0123','110','CLS','Sara Jones','Pending','Exterior','Emergency circuit tested and tagged; report signed by site contact.','Emergency circuit tested and tagged; report signed by site contact.',2,1,'Technician'),(12,'acombes','5f4dcc3b5aa765d61d8327deb882cf99','acombes@clsgreen.com',1,2,'204-555-0123','905-555-0142','111','North','André Combes','Alliance','Maintenance','Emergency circuit tested and tagged; report signed by site contact.','Emergency circuit tested and tagged; report signed by site contact.',3,1,'Office');
/*!40000 ALTER TABLE `users` ENABLE KEYS */;


--
-- Table structure for table `user_permissions`
--

DROP TABLE IF EXISTS `user_permissions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `user_permissions` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) DEFAULT NULL,
  `permission_name` varchar(50) DEFAULT NULL,
  `is_allowed` int(11) DEFAULT NULL,
  `permission_date` date DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `user_permissions`
--

/*!40000 ALTER TABLE `user_permissions` DISABLE KEYS */;
INSERT INTO `user_permissions` VALUES (1,1,'workorders.view',1,'2025-03-01'),(2,2,'workorders.edit',NULL,NULL),(3,3,'quotes.edit',3,NULL),(4,4,'purchasing.approve',4,'2025-03-04'),(5,NULL,'reports.view',5,'0000-00-00'),(6,6,'users.admin',6,'2025-03-06');
/*!40000 ALTER TABLE `user_permissions` ENABLE KEYS */;


--
-- Table structure for table `user_permissions_price_management`
--

DROP TABLE IF EXISTS `user_permissions_price_management`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `user_permissions_price_management` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) DEFAULT NULL,
  `allowed_by` int(11) DEFAULT NULL,
  `permission_date` date NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `user_permissions_price_management`
--

/*!40000 ALTER TABLE `user_permissions_price_management` DISABLE KEYS */;
INSERT INTO `user_permissions_price_management` VALUES (1,1,1,'2025-03-01'),(2,2,2,'2025-03-02');
/*!40000 ALTER TABLE `user_permissions_price_management` ENABLE KEYS */;


--
-- Table structure for table `permission_type`
--

DROP TABLE IF EXISTS `permission_type`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `permission_type` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `permission_name` varchar(50) DEFAULT NULL,
  `permission_heading` varchar(50) DEFAULT NULL,
  `sortorder` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `permission_type`
--

/*!40000 ALTER TABLE `permission_type` DISABLE KEYS */;
/*!40000 ALTER TABLE `permission_type` ENABLE KEYS */;


--
-- Table structure for table `parts`
--

DROP TABLE IF EXISTS `parts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `parts` (
  `name` text DEFAULT NULL,
  `number` varchar(50) DEFAULT NULL,
  `cost` decimal(7,2) DEFAULT NULL,
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `subignore` tinyint(3) DEFAULT NULL,
  `sell_price` decimal(7,2) DEFAULT NULL,
  `sage_id` int(11) DEFAULT NULL,
  `part_group_id` int(11) DEFAULT NULL,
  `warranty` varchar(75) DEFAULT NULL,
  `labor_warranty` varchar(75) DEFAULT NULL,
  `purchased_quantity` decimal(7,2) DEFAULT NULL,
  `current_quantity` decimal(7,2) DEFAULT NULL,
  `sold_quantity` decimal(7,2) DEFAULT NULL,
  `installcostperunit` varchar(15) DEFAULT NULL,
  `install_profit_formula` varchar(50) DEFAULT NULL,
  `recycle_profit_formula` varchar(50) DEFAULT NULL,
  `saved_sage_price` varchar(50) DEFAULT NULL,
  `is_sage_saved` int(11) DEFAULT NULL,
  `part_popup_notes` text DEFAULT NULL,
  `parent_partnumber` varchar(50) DEFAULT NULL,
  `cls_linked_partcode` varchar(20) DEFAULT NULL,
  `active_in_sage` int(11) DEFAULT NULL,
  `defaultsortorder` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `parts`
--

/*!40000 ALTER TABLE `parts` DISABLE KEYS */;
INSERT INTO `parts` VALUES ('Ballast 2-lamp T8 electronic','CLS-1001',22.50,1,1,45.00,1,1,'Scheduled','Alliance',40.00,18.00,22.00,NULL,'45.00','12.50',NULL,1,'Replaced driver and verified output on all four fixtures.',NULL,'CLS-1003',1,1),('Lamp LED T8 4ft 12W','CLS-1002',8.40,2,2,18.75,2,1,'Maintenance','Exterior',2.00,240.00,2.00,'12.50','410.00','','45.00',2,'Replaced driver and verified output on all four fixtures.','CLS-1003','CLS-1004',1,2),('Exit sign LED emergency','CLS-1003',61.20,3,3,120.50,3,2,'Exterior','Completed',3.00,7.00,3.00,'$95.00','0.00','','1,234.50',3,NULL,'CLS-1004','CLS-1005',1,3),('Emergency battery unit 90 min','CLS-1004',48.00,4,4,95.00,4,2,'Interior','Interior',4.00,0.00,4.00,'45.00','12.50','12.50','410.00',4,'Vérifier le câblage et la boîte de jonction avant la prochaine visite.','CLS-1005','CLS-1006',0,4),('Lens diffuser 2x4','CLS-1005',6.10,5,5,12.75,5,3,'Interior','Maintenance',5.00,54.00,5.00,'1,234.50','45.00','45.00','410.00',5,'Vérifier le câblage et la boîte de jonction avant la prochaine visite.','CLS-1006','CLS-1007',1,1),('Troffer door frame','CLS-1006',11.25,6,6,24.00,6,3,'Interior','CLS',6.00,31.00,6.00,'12.50','$95.00','0.00','45.00',6,'Commande reçue partielle, reste 2 unités en reliquat.','CLS-1007','CLS-1008',1,2),('Occupancy sensor ceiling mount','CLS-1007',34.80,7,7,72.00,7,1,'Scheduled','Alliance',7.00,12.00,NULL,'410.00','12.50',NULL,NULL,7,'Commande reçue partielle, reste 2 unités en reliquat.','CLS-1008','CLS-1009',1,3),('Fluorescent lamp F32T8','CLS-1008',2.75,8,8,6.50,8,1,'Alliance','Interior',1.00,410.00,1.00,'','1,234.50','1,234.50','0.00',8,'Commande reçue partielle, reste 2 unités en reliquat.','CLS-1009','CLS-1010',1,4),('Emergency light head','CLS-1009',41.00,9,9,85.00,9,2,NULL,'Exterior',2.00,5.00,2.00,'45.00','410.00','410.00','1,234.50',9,'Replaced driver and verified output on all four fixtures.','CLS-1010','CLS-1001',1,1),('Photocell 120V','CLS-1010',13.30,10,1,29.95,1,3,'Alliance','Standard',3.00,0.00,3.00,'45.00','$95.00','12.50',NULL,1,'Customer approved the repair by email; completion photo attached.','CLS-1001','CLS-1002',0,2);
/*!40000 ALTER TABLE `parts` ENABLE KEYS */;


--
-- Table structure for table `parts_group`
--

DROP TABLE IF EXISTS `parts_group`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `parts_group` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` text DEFAULT NULL,
  `sort_id` int(11) DEFAULT NULL,
  `is_winner` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `parts_group`
--

/*!40000 ALTER TABLE `parts_group` DISABLE KEYS */;
INSERT INTO `parts_group` VALUES (1,'Priya Raman',1,1),(2,'Derek Chan',2,2),(3,'Derek Chan',NULL,3);
/*!40000 ALTER TABLE `parts_group` ENABLE KEYS */;


--
-- Table structure for table `parts_selling_rates`
--

DROP TABLE IF EXISTS `parts_selling_rates`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `parts_selling_rates` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `part_code` varchar(50) DEFAULT NULL,
  `list_id` int(11) DEFAULT NULL,
  `old_sell_price` decimal(7,2) DEFAULT NULL,
  `increase_percentage` int(11) DEFAULT NULL,
  `sell_price` decimal(7,2) DEFAULT NULL,
  `install_price` decimal(7,2) DEFAULT NULL,
  `recycle_price` decimal(7,2) DEFAULT NULL,
  `date_inserted` timestamp DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `parts_selling_rates`
--

/*!40000 ALTER TABLE `parts_selling_rates` DISABLE KEYS */;
INSERT INTO `parts_selling_rates` VALUES (1,'CLS-1001',1,14.31,1,16.49,13.16,14.06,'2025-03-01 09:30:00'),(2,'CLS-1002',2,NULL,2,23.74,20.41,21.31,NULL),(3,'CLS-1003',1,28.81,3,30.99,27.66,28.56,'2025-03-03 09:30:00'),(4,'CLS-1004',NULL,36.06,4,38.24,34.91,35.81,'2025-03-04 09:30:00');
/*!40000 ALTER TABLE `parts_selling_rates` ENABLE KEYS */;


--
-- Table structure for table `parts_selling_rates_list`
--

DROP TABLE IF EXISTS `parts_selling_rates_list`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `parts_selling_rates_list` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `list_heading` varchar(100) DEFAULT NULL,
  `list_date` date DEFAULT NULL,
  `is_winner` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `parts_selling_rates_list`
--

/*!40000 ALTER TABLE `parts_selling_rates_list` DISABLE KEYS */;
INSERT INTO `parts_selling_rates_list` VALUES (1,'Marc Tremblay','2025-03-01',1),(2,'Marc Tremblay','2025-03-02',2);
/*!40000 ALTER TABLE `parts_selling_rates_list` ENABLE KEYS */;


--
-- Table structure for table `parts_supplier_rates`
--

DROP TABLE IF EXISTS `parts_supplier_rates`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `parts_supplier_rates` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `part_code` varchar(50) DEFAULT NULL,
  `list_id` int(11) DEFAULT NULL,
  `supplier_id` int(11) DEFAULT NULL,
  `sub_supplier_id` int(11) DEFAULT NULL,
  `cost_price` varchar(50) DEFAULT NULL,
  `last_cost_price` varchar(30) DEFAULT NULL,
  `date_inserted` timestamp DEFAULT NULL,
  `markup` decimal(7,2) DEFAULT NULL,
  `sell_price` decimal(7,2) DEFAULT NULL,
  `last_sell_price` decimal(7,2) DEFAULT NULL,
  `install_price` decimal(7,2) DEFAULT NULL,
  `recycle_price` decimal(7,2) DEFAULT NULL,
  `default_rate` int(11) DEFAULT NULL,
  `model_number_1` text DEFAULT NULL,
  `model_number_2` text DEFAULT NULL,
  `model_number_3` text DEFAULT NULL,
  `supplier_warranty` varchar(10) DEFAULT NULL,
  `cost_price_decimal` decimal(7,2) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `parts_supplier_rates`
--

/*!40000 ALTER TABLE `parts_supplier_rates` DISABLE KEYS */;
INSERT INTO `parts_supplier_rates` VALUES (1,'CLS-1001',1,1,1,'45.00','$95.00','2025-03-01 09:30:00',12.95,16.49,NULL,13.16,14.06,1,'MOD-2095','MOD-2095','','1 year',14.72),(2,'CLS-1002',2,2,2,'0.00','410.00','2025-03-02 09:30:00',20.20,23.74,22.63,20.41,NULL,2,'MOD-2095','MOD-4410',NULL,'1 year',21.97),(3,'CLS-1003',1,3,3,'45.00','$95.00','2025-03-03 09:30:00',27.45,30.99,29.88,27.66,28.56,3,'MOD-6622','MOD-7781','MOD-2095','',29.22);
/*!40000 ALTER TABLE `parts_supplier_rates` ENABLE KEYS */;


--
-- Table structure for table `parts_supplier_rates_list`
--

DROP TABLE IF EXISTS `parts_supplier_rates_list`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `parts_supplier_rates_list` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `supplier_id` int(11) DEFAULT NULL,
  `list_heading` varchar(100) DEFAULT NULL,
  `list_date` date DEFAULT NULL,
  `has_buy_rates` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `parts_supplier_rates_list`
--

/*!40000 ALTER TABLE `parts_supplier_rates_list` DISABLE KEYS */;
INSERT INTO `parts_supplier_rates_list` VALUES (1,1,'Jocelyn Roy','2025-03-01',1),(2,2,'','2025-03-02',2);
/*!40000 ALTER TABLE `parts_supplier_rates_list` ENABLE KEYS */;


--
-- Table structure for table `parts_price_history`
--

DROP TABLE IF EXISTS `parts_price_history`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `parts_price_history` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `price_id` int(11) NOT NULL,
  `field_name` varchar(30) NOT NULL,
  `last_value` varchar(30) DEFAULT NULL,
  `new_value` varchar(30) DEFAULT NULL,
  `user_name` varchar(50) NOT NULL,
  `section_name` text DEFAULT NULL,
  `date_inserted` timestamp DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `parts_price_history`
--

/*!40000 ALTER TABLE `parts_price_history` DISABLE KEYS */;
INSERT INTO `parts_price_history` VALUES (1,1,'sell_price','1,234.50','12.50','Jocelyn Roy','Luminaire extérieur remplacé, façade ô côté cour.','2025-03-01 09:30:00'),(2,2,'cost','410.00','1,234.50','Hélène Girard','Customer approved the repair by email; completion photo attached.','2025-03-02 09:30:00'),(3,3,'install_price','410.00','45.00','Marc Tremblay','Emergency circuit tested and tagged; report signed by site contact.','2025-03-03 09:30:00'),(4,4,'recycle_price','45.00','12.50','Priya Raman','Replaced driver and verified output on all four fixtures.','2025-03-04 09:30:00');
/*!40000 ALTER TABLE `parts_price_history` ENABLE KEYS */;


--
-- Table structure for table `shared_parts_list`
--

DROP TABLE IF EXISTS `shared_parts_list`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `shared_parts_list` (
  `partcode` varchar(15) NOT NULL,
  `main_partcode` varchar(15) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `shared_parts_list`
--

/*!40000 ALTER TABLE `shared_parts_list` DISABLE KEYS */;
INSERT INTO `shared_parts_list` VALUES ('CLS-1001','CLS-1002'),('CLS-1002','CLS-1003'),('CLS-1003','CLS-1004');
/*!40000 ALTER TABLE `shared_parts_list` ENABLE KEYS */;


--
-- Table structure for table `prf`
--

DROP TABLE IF EXISTS `prf`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `prf` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `woid` int(11) NOT NULL,
  `description` text DEFAULT NULL,
  `tech` varchar(50) NOT NULL,
  `date` date NOT NULL,
  `notes` text DEFAULT NULL,
  `eta` date DEFAULT NULL,
  `status` varchar(50) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `prf`
--

/*!40000 ALTER TABLE `prf` DISABLE KEYS */;
INSERT INTO `prf` VALUES (1,1001,'Emergency circuit tested and tagged; report signed by site contact.','Marc Tremblay','2025-03-01','Replaced driver and verified output on all four fixtures.','2025-03-01','received'),(2,1002,'Replaced driver and verified output on all four fixtures.','Sophie Dubé','2025-03-02','Luminaire extérieur remplacé, façade ô côté cour.',NULL,'sold');
/*!40000 ALTER TABLE `prf` ENABLE KEYS */;


--
-- Table structure for table `wo_next_pid`
--

DROP TABLE IF EXISTS `wo_next_pid`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `wo_next_pid` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `next_id` bigint(20) DEFAULT NULL,
  `comments` text DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `wo_next_pid`
--

/*!40000 ALTER TABLE `wo_next_pid` DISABLE KEYS */;
INSERT INTO `wo_next_pid` VALUES (1,10010,'Next work order number after the freeze');
/*!40000 ALTER TABLE `wo_next_pid` ENABLE KEYS */;


--
-- Table structure for table `parts_sub_suppliers`
--

DROP TABLE IF EXISTS `parts_sub_suppliers`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `parts_sub_suppliers` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `supplier_id` int(11) DEFAULT NULL,
  `name` varchar(50) DEFAULT NULL,
  `location` text DEFAULT NULL,
  `contact_number` varchar(50) DEFAULT NULL,
  `contact_emails` text DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `parts_sub_suppliers`
--

/*!40000 ALTER TABLE `parts_sub_suppliers` DISABLE KEYS */;
/*!40000 ALTER TABLE `parts_sub_suppliers` ENABLE KEYS */;


--
-- Table structure for table `parts_supplier_model_rates`
--

DROP TABLE IF EXISTS `parts_supplier_model_rates`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `parts_supplier_model_rates` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `part_code` varchar(50) DEFAULT NULL,
  `list_id` int(11) DEFAULT NULL,
  `supplier_id` int(11) DEFAULT NULL,
  `model_price` varchar(50) DEFAULT NULL,
  `default_model` int(11) DEFAULT NULL,
  `model_number` text DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `parts_supplier_model_rates`
--

/*!40000 ALTER TABLE `parts_supplier_model_rates` DISABLE KEYS */;
/*!40000 ALTER TABLE `parts_supplier_model_rates` ENABLE KEYS */;


--
-- Table structure for table `subcontractor_wsib_insurance_documents`
--

DROP TABLE IF EXISTS `subcontractor_wsib_insurance_documents`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `subcontractor_wsib_insurance_documents` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `subid` int(11) NOT NULL,
  `document_type` varchar(20) DEFAULT NULL,
  `document_name` text DEFAULT NULL,
  `file_name` varchar(200) DEFAULT NULL,
  `is_expired` int(2) DEFAULT NULL,
  `expiration_timespan` int(20) DEFAULT NULL,
  `expiration_date` date DEFAULT NULL,
  `uploaded_timespan` int(20) DEFAULT NULL,
  `near_expire_reminder_done` int(11) DEFAULT NULL,
  `send_email_to_sub` int(11) DEFAULT NULL,
  `email_sent_success` int(11) DEFAULT NULL,
  `last_reminder_date` date DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `subcontractor_wsib_insurance_documents`
--

/*!40000 ALTER TABLE `subcontractor_wsib_insurance_documents` DISABLE KEYS */;
INSERT INTO `subcontractor_wsib_insurance_documents` VALUES (1,1,'wsib','Hélène Girard','document-1.pdf',1,1,'2025-03-01',1,1,1,1,'2025-03-01'),(2,2,'insurance','Luc Côté','document-2.pdf',2,2,NULL,2,NULL,2,2,'2025-03-02'),(3,3,'wcb','Priya Raman','document-3.pdf',3,3,'2025-03-03',3,3,3,3,'2025-03-03');
/*!40000 ALTER TABLE `subcontractor_wsib_insurance_documents` ENABLE KEYS */;


--
-- Table structure for table `subcontractor_additional_documents`
--

DROP TABLE IF EXISTS `subcontractor_additional_documents`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `subcontractor_additional_documents` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `subid` int(11) NOT NULL,
  `document_name` text DEFAULT NULL,
  `file_name` varchar(200) DEFAULT NULL,
  `document_notes` text DEFAULT NULL,
  `uploaded_timespan` int(20) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `subcontractor_additional_documents`
--

/*!40000 ALTER TABLE `subcontractor_additional_documents` DISABLE KEYS */;
INSERT INTO `subcontractor_additional_documents` VALUES (1,1,'Sophie Dubé',NULL,'Luminaire extérieur remplacé, façade ô côté cour.',1),(2,2,'Hélène Girard',NULL,'Luminaire extérieur remplacé, façade ô côté cour.',2),(3,3,'Derek Chan','document-3.pdf','Luminaire extérieur remplacé, façade ô côté cour.',3);
/*!40000 ALTER TABLE `subcontractor_additional_documents` ENABLE KEYS */;


--
-- Table structure for table `material_warranty`
--

DROP TABLE IF EXISTS `material_warranty`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `material_warranty` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `partno` varchar(30) DEFAULT NULL,
  `partdesc` text DEFAULT NULL,
  `woid` int(11) DEFAULT NULL,
  `site_id` int(11) DEFAULT NULL,
  `warranty_type` enum('warranty','labor') DEFAULT NULL,
  `start_date` date DEFAULT NULL,
  `expiration_date` date DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `material_warranty`
--

/*!40000 ALTER TABLE `material_warranty` DISABLE KEYS */;
INSERT INTO `material_warranty` VALUES (1,'CLS-1001','Luminaire extérieur remplacé, façade ô côté cour.',1001,1,'warranty','2025-03-01','2025-03-01'),(2,NULL,'',1002,2,'labor','2025-03-02','2025-03-02'),(3,'CLS-1003','Emergency circuit tested and tagged; report signed by site contact.',1003,3,NULL,'2025-03-03','2025-03-03');
/*!40000 ALTER TABLE `material_warranty` ENABLE KEYS */;


--
-- Table structure for table `site_warranty`
--

DROP TABLE IF EXISTS `site_warranty`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `site_warranty` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `site_id` int(11) NOT NULL,
  `warranty_notes` text DEFAULT NULL,
  `expiration_timespan` int(11) DEFAULT NULL,
  `expiration_date` date DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `site_warranty`
--

/*!40000 ALTER TABLE `site_warranty` DISABLE KEYS */;
INSERT INTO `site_warranty` VALUES (1,1,'Emergency circuit tested and tagged; report signed by site contact.',NULL,'2025-03-01'),(2,2,'Luminaire extérieur remplacé, façade ô côté cour.',2,'2025-03-02'),(3,3,'Commande reçue partielle, reste 2 unités en reliquat.',3,'2025-03-03');
/*!40000 ALTER TABLE `site_warranty` ENABLE KEYS */;


--
-- Table structure for table `signoff_cron`
--

DROP TABLE IF EXISTS `signoff_cron`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `signoff_cron` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `woid` int(11) NOT NULL,
  `is_processed` int(11) DEFAULT NULL,
  `timespan_uploaded` int(11) DEFAULT NULL,
  `timespan_processed` int(11) DEFAULT NULL,
  `signature_found` int(11) DEFAULT NULL,
  `is_reviewed` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `signoff_cron`
--

/*!40000 ALTER TABLE `signoff_cron` DISABLE KEYS */;
INSERT INTO `signoff_cron` VALUES (1,1001,1,1,1,1,1),(2,1002,2,2,2,2,2);
/*!40000 ALTER TABLE `signoff_cron` ENABLE KEYS */;


--
-- Table structure for table `workorder`
--

DROP TABLE IF EXISTS `workorder`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `workorder` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `site` int(11) NOT NULL,
  `servicetype` tinyint(2) NOT NULL,
  `priority` tinyint(2) NOT NULL,
  `dne` int(11) NOT NULL,
  `status` tinyint(2) NOT NULL,
  `datetaken` date NOT NULL,
  `expcompletion` date NOT NULL,
  `servicerequired` text NOT NULL,
  `notes` text DEFAULT NULL,
  `subcontractor` int(11) DEFAULT NULL,
  `completiondate` varchar(120) DEFAULT NULL,
  `securitycode` varchar(100) DEFAULT NULL,
  `customerpo` varchar(100) DEFAULT NULL,
  `local` tinyint(3) NOT NULL,
  `tech` int(4) DEFAULT NULL,
  `tech_2` int(11) DEFAULT NULL,
  `tech_labour_rate` decimal(7,2) DEFAULT NULL,
  `invdate` date DEFAULT NULL,
  `calc_inv_date` date DEFAULT NULL,
  `customer` int(11) DEFAULT NULL,
  `wo_folder_attach_path` varchar(200) DEFAULT NULL,
  `printed` varchar(10) DEFAULT NULL,
  `batched` date DEFAULT NULL,
  `schannel` int(1) NOT NULL,
  `schannel_redone` int(11) DEFAULT NULL,
  `sgsales_done` int(11) DEFAULT NULL,
  `sgpurch_done` int(11) DEFAULT NULL,
  `forced_enable_sc_transfer` int(11) DEFAULT NULL,
  `ready_for_calc_timespan` bigint(20) DEFAULT NULL,
  `closeout_tech` int(11) DEFAULT NULL,
  `closeout_tech_2` int(11) DEFAULT NULL,
  `is_marked_red` int(11) DEFAULT NULL,
  `is_marked_green` int(11) DEFAULT NULL,
  `is_marked_critical` int(11) DEFAULT NULL,
  `is_project_wo` tinyint(4) DEFAULT NULL,
  `customer_quote_id` varchar(50) DEFAULT NULL,
  `is_tjx_quote` int(11) DEFAULT NULL,
  `is_pma_order` tinyint(1) DEFAULT NULL,
  `is_pma_bckup` varchar(12) DEFAULT NULL,
  `stock_updated` int(11) DEFAULT NULL,
  `marked_invoiced_time` int(11) DEFAULT NULL,
  `enable_sale_stock_upd_btn` int(11) DEFAULT NULL,
  `only_portal_stock_updated` int(11) DEFAULT NULL,
  `assigned_dispatch_id` int(11) DEFAULT NULL,
  `pma_order_category` varchar(25) DEFAULT NULL,
  `primary_workorder` varchar(20) DEFAULT NULL,
  `add_to_local_modify_once` int(11) DEFAULT NULL,
  `sc_primary_status` varchar(20) DEFAULT NULL,
  `sc_extended_status` varchar(20) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `workorder`
--

/*!40000 ALTER TABLE `workorder` DISABLE KEYS */;
INSERT INTO `workorder` VALUES (0,1,1,1,1,1,'0000-00-00','0000-00-00','Placeholder work order created by the portal import',NULL,1,'2025-03-01','SC-4000','',0,1,1,14.94,NULL,'2025-03-01',1,'Alliance','1','2025-03-01',0,1,1,NULL,1,1,1,NULL,1,1,1,NULL,1,NULL,NULL,'0',1,1,1,1,1,'Fire Alarm','1001',1,'new',NULL),(1001,1,1,2,2,2,'2025-03-02','2025-03-02','Replace ballast in two fixtures','Driver replaced and output verified.',2,'2025-03-14',NULL,'PO-2001',0,2,2,22.19,'2025-03-18',NULL,1,'C:\\alliance\\wo\\2025\\1001','0','2025-03-02',0,2,2,2,2,2,2,2,2,NULL,2,2,2,2,2,'0',2,2,NULL,2,2,'Lighting',NULL,2,'in_progress','in_progress'),(1002,2,3,3,3,3,'2025-03-03','2025-03-03','Emergency lighting inspection','',3,'0000-00-00','SC-4002','Scheduled',0,3,3,NULL,'2025-03-03','2025-03-03',2,'Scheduled','1','2025-03-03',0,3,3,3,NULL,3,NULL,3,3,NULL,NULL,3,3,3,3,'0',3,3,3,3,3,NULL,'1003',3,'completed','completed'),(1003,3,4,1,4,1,'2025-03-04','2025-03-04','Repair parking lot pole light','No site record found for this customer id.',4,'2025-03-04','SC-4003','CLS',0,NULL,4,36.69,'2025-03-04','2025-03-04',7777,'',NULL,'2025-03-04',0,4,4,4,4,4,4,4,4,4,4,4,4,4,NULL,'0',4,4,4,4,4,'Fire Alarm','1004',4,'cancelled','cancelled'),(1004,6,5,2,5,1,'0000-00-00','0000-00-00','Replace exit sign battery','Luminaire extérieur remplacé, façade ô côté cour.',5,'2025-03-05','SC-4004','Maintenance',0,NULL,5,43.94,'0000-00-00','0000-00-00','','Maintenance',NULL,'0000-00-00',0,5,5,5,NULL,1,5,5,5,5,5,5,5,5,5,'0',5,5,NULL,5,5,'Lighting','1005',5,'new','new'),(1005,1,6,3,6,2,'2025-03-06','2025-03-06','Réparation du luminaire extérieur, façade ô côté','Replaced ballast.\nTested emergency circuit.\nLeft site at 16:30.',1,'2025-03-06','','North',1,6,6,51.19,'2025-03-06','2025-03-06',1,NULL,'0','2025-03-06',0,6,6,6,6,2,6,6,6,6,6,6,1,6,6,'0',NULL,6,6,6,6,'Emergency',NULL,6,'in_progress','in_progress'),(1006,2,7,1,7,2,'0000-00-00','2025-01-31','Troubleshoot photocell','Luminaire extérieur remplacé, façade ô côté cour.',2,'2025-03-07',NULL,'Pending',0,7,7,58.44,'0000-00-00','2025-03-07',2,NULL,'1','2025-03-07',0,7,7,7,NULL,3,7,7,NULL,7,7,7,2,7,7,'0',7,7,7,7,7,'Fire Alarm','1007',7,'completed','completed'),(1007,3,8,2,8,3,'2025-03-08','2025-03-08','Lamp replacement, 24 fixtures',NULL,3,NULL,'SC-4007','Exterior',0,8,8,NULL,'2025-03-08','2025-03-08',3,'Scheduled','0','2025-03-08',0,8,8,8,8,NULL,8,8,8,8,8,8,3,8,8,NULL,8,8,8,8,8,'Lighting','1008',8,'cancelled','cancelled'),(1008,4,9,3,9,1,'2025-03-09','2025-03-09','Réparer le panneau de contrôle','Vérifier le câblage et la boîte de jonction.',4,'2025-03-09','SC-4008','Exterior',0,9,9,72.94,NULL,'2025-03-09',4,'Exterior',NULL,'2025-03-09',0,9,9,9,9,1,9,9,9,9,NULL,9,4,9,9,'0',9,9,9,9,9,'Emergency','1009',9,'','new'),(1009,5,1,1,1,4,'0000-00-00','0000-00-00','Remove damaged troffer','Customer approved the repair by email; completion photo attached.',5,'2025-03-10','SC-4009','Exterior',0,10,10,80.19,'0000-00-00','0000-00-00',5,'Interior','0','0000-00-00',0,1,1,1,1,2,NULL,10,1,NULL,1,NULL,NULL,1,1,'0',1,1,1,1,10,'Fire Alarm','1001',1,'in_progress','in_progress'),(9999998,2,2,2,2,1,'2025-03-11','2025-03-11','Emergency circuit tested and tagged; report signed by site contact.','Customer approved the repair by email; completion photo attached.',1,'2025-03-11','SC-4010','Standard',0,11,NULL,87.44,'2025-03-11','2025-03-11',2,'Pending','1','2025-03-11',0,2,2,2,2,3,11,11,2,2,2,2,1,2,2,'',2,2,2,2,11,'Lighting','1002',2,NULL,'completed'),(9999999,3,3,3,3,1,'2025-03-12','2025-03-12','Emergency circuit tested and tagged; report signed by site contact.','Replaced driver and verified output on all four fixtures.',2,'2025-03-12','SC-4011','Standard',0,12,12,94.69,'2025-03-12',NULL,3,'','0','2025-03-12',0,3,3,3,3,NULL,12,12,3,3,3,3,2,3,3,'0',3,3,3,3,12,'Emergency','1003',3,'cancelled','cancelled'),(44444444,4,4,1,4,1,'2025-03-13','2025-03-13','Customer approved the repair by email; completion photo attached.','Vérifier le câblage et la boîte de jonction avant la prochaine visite.',NULL,'2025-03-13','SC-4012','Scheduled',0,1,1,101.94,'2025-03-13','2025-03-13',4,'Pending','1','2025-03-13',0,4,4,4,4,1,1,1,4,4,NULL,4,3,4,4,'0',4,4,4,4,1,NULL,'1004',4,'new','new'),(99999999,5,5,2,5,1,'2025-03-14','2025-03-14','Emergency circuit tested and tagged; report signed by site contact.','Vérifier le câblage et la boîte de jonction avant la prochaine visite.',4,'2025-03-14','SC-4013','Pending',0,2,NULL,109.19,'2025-03-14','2025-03-14',5,'Interior','0','2025-03-14',0,5,5,NULL,5,2,2,2,5,5,5,5,4,5,5,'0',5,5,5,5,NULL,'Lighting','1005',5,'in_progress','in_progress');
/*!40000 ALTER TABLE `workorder` ENABLE KEYS */;


--
-- Table structure for table `wo_hours`
--

DROP TABLE IF EXISTS `wo_hours`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `wo_hours` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `woid` int(11) NOT NULL,
  `rate` tinyint(3) DEFAULT NULL,
  `date` date NOT NULL,
  `hours` decimal(7,2) NOT NULL,
  `hourly_rate` decimal(7,2) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `wo_hours`
--

/*!40000 ALTER TABLE `wo_hours` DISABLE KEYS */;
INSERT INTO `wo_hours` VALUES (1,1001,1,'2025-03-01',1.00,12.97),(2,1002,2,'2025-03-02',2.00,20.22),(3,1003,3,'2025-03-03',3.00,27.47),(4,1004,1,'2025-03-04',4.00,34.72),(5,1005,2,'0000-00-00',5.00,41.97),(6,1006,3,'2025-03-06',6.00,49.22);
/*!40000 ALTER TABLE `wo_hours` ENABLE KEYS */;


--
-- Table structure for table `localwo_hours`
--

DROP TABLE IF EXISTS `localwo_hours`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `localwo_hours` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `woid` int(10) NOT NULL,
  `date` date NOT NULL,
  `timein` time NOT NULL,
  `timeout` time NOT NULL,
  `hours` decimal(7,2) NOT NULL,
  `numtechs` int(10) NOT NULL,
  `tech` int(10) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `localwo_hours`
--

/*!40000 ALTER TABLE `localwo_hours` DISABLE KEYS */;
INSERT INTO `localwo_hours` VALUES (1,1001,'2025-03-01','07:30:00','16:00:00',1.00,1,1),(2,1002,'2025-03-02','07:30:00','16:00:00',2.00,2,2),(3,1003,'2025-03-03','07:30:00','16:00:00',3.00,3,3);
/*!40000 ALTER TABLE `localwo_hours` ENABLE KEYS */;


--
-- Table structure for table `localwo_techs`
--

DROP TABLE IF EXISTS `localwo_techs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `localwo_techs` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `woid` int(10) NOT NULL,
  `date` datetime DEFAULT NULL,
  `tech` int(10) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `localwo_techs`
--

/*!40000 ALTER TABLE `localwo_techs` DISABLE KEYS */;
INSERT INTO `localwo_techs` VALUES (1,1001,'2025-03-01 09:30:00',1),(2,1002,'2025-03-02 09:30:00',2),(3,1003,'2025-03-03 09:30:00',3);
/*!40000 ALTER TABLE `localwo_techs` ENABLE KEYS */;


--
-- Table structure for table `wo_soparts`
--

DROP TABLE IF EXISTS `wo_soparts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `wo_soparts` (
  `id` int(120) NOT NULL AUTO_INCREMENT,
  `woid` int(10) NOT NULL,
  `name` text NOT NULL,
  `qty` decimal(7,2) NOT NULL,
  `price` decimal(7,2) NOT NULL,
  `is_emergency_lighting` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `wo_soparts`
--

/*!40000 ALTER TABLE `wo_soparts` DISABLE KEYS */;
INSERT INTO `wo_soparts` VALUES (1,1001,'Derek Chan',1.00,15.80,1),(2,1002,'Ana Ferreira',2.00,23.05,2),(3,1003,'Marc Tremblay',3.00,30.30,3),(4,1004,'Luc Côté',4.00,37.55,4);
/*!40000 ALTER TABLE `wo_soparts` ENABLE KEYS */;


--
-- Table structure for table `wo_parts`
--

DROP TABLE IF EXISTS `wo_parts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `wo_parts` (
  `id` int(12) NOT NULL AUTO_INCREMENT,
  `woid` int(11) NOT NULL,
  `partno` varchar(50) NOT NULL,
  `qty` decimal(7,2) NOT NULL,
  `price` decimal(7,2) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `wo_parts`
--

/*!40000 ALTER TABLE `wo_parts` DISABLE KEYS */;
INSERT INTO `wo_parts` VALUES (1,1001,'CLS-1001',2.00,45.00),(2,1002,'CLS-1002',1.00,120.50),(3,1003,'---',1.00,0.00),(4,1004,'--',3.00,12.75),(5,88888881,'CLS-1005',1.00,9.99),(6,88888882,'CLS-1006',1.00,18.40),(7,88888883,'CLS-1007',2.00,7.25),(8,88888884,'CLS-1008',1.00,NULL);
/*!40000 ALTER TABLE `wo_parts` ENABLE KEYS */;


--
-- Table structure for table `wo_tax`
--

DROP TABLE IF EXISTS `wo_tax`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `wo_tax` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `woid` int(10) NOT NULL,
  `tax` decimal(7,2) NOT NULL,
  `name` varchar(5) NOT NULL,
  `tax_total` decimal(7,2) DEFAULT NULL,
  `tax_gst` decimal(7,2) DEFAULT NULL,
  `tax_pst` decimal(7,2) DEFAULT NULL,
  `appliedtaxrate` varchar(15) DEFAULT NULL,
  `appliedtaxrate_pst` varchar(15) DEFAULT NULL,
  `appliedtaxrate_gst` varchar(15) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `wo_tax`
--

/*!40000 ALTER TABLE `wo_tax` DISABLE KEYS */;
INSERT INTO `wo_tax` VALUES (1,1001,14.20,'Ana Ferreira',13.53,14.89,15.32,NULL,'0.000','5.000'),(2,1002,21.45,'Derek Chan',20.78,22.14,22.57,'13.000','0.000','5.000'),(3,1003,28.70,'Marc Tremblay',28.03,29.39,NULL,NULL,'0.000','5.000'),(4,1004,35.95,'Sophie Dubé',35.28,36.64,37.07,'13.000','0.000','5.000');
/*!40000 ALTER TABLE `wo_tax` ENABLE KEYS */;


--
-- Table structure for table `wo_report`
--

DROP TABLE IF EXISTS `wo_report`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `wo_report` (
  `id` int(11) unsigned NOT NULL AUTO_INCREMENT,
  `woid` int(10) unsigned NOT NULL,
  `report` text DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `wo_report`
--

/*!40000 ALTER TABLE `wo_report` DISABLE KEYS */;
INSERT INTO `wo_report` VALUES (1,1001,'Customer approved the repair by email; completion photo attached.'),(2,1002,'Customer approved the repair by email; completion photo attached.'),(3,1003,'Luminaire extérieur remplacé, façade ô côté cour.');
/*!40000 ALTER TABLE `wo_report` ENABLE KEYS */;


--
-- Table structure for table `wo_notes`
--

DROP TABLE IF EXISTS `wo_notes`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `wo_notes` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `woid` int(11) NOT NULL,
  `user_id` int(11) NOT NULL,
  `notes` text DEFAULT NULL,
  `title` varchar(100) DEFAULT NULL,
  `emails` varchar(100) DEFAULT NULL,
  `notes_type` varchar(30) DEFAULT NULL,
  `previous_status_id` int(11) DEFAULT NULL,
  `status_id` int(11) DEFAULT NULL,
  `is_public` tinyint(4) DEFAULT NULL,
  `date_created` timestamp DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `wo_notes`
--

/*!40000 ALTER TABLE `wo_notes` DISABLE KEYS */;
INSERT INTO `wo_notes` VALUES (1,1001,1,'Called site contact; access confirmed for 8:00.','Dispatch note',NULL,'status',1,2,1,'2025-03-12 08:12:00'),(2,1001,4,'Ballast replaced. Vérifier le niveau de luminosité.','Work performed','Standard','note',2,3,0,'2025-03-14 16:40:00'),(3,1002,2,'Client asked to reschedule to Friday.','Reschedule','','note',1,1,1,'2025-03-13 09:05:00'),(4,1008,10,NULL,'Empty note, kept for history','Pending','note',4,4,0,'0000-00-00 00:00:00');
/*!40000 ALTER TABLE `wo_notes` ENABLE KEYS */;


--
-- Table structure for table `wo_revisions`
--

DROP TABLE IF EXISTS `wo_revisions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `wo_revisions` (
  `revision_id` int(11) NOT NULL AUTO_INCREMENT,
  `woid` int(11) DEFAULT NULL,
  `created_time` timestamp DEFAULT NULL,
  `revised_by_user` int(11) DEFAULT NULL,
  `revision_type` varchar(45) DEFAULT NULL,
  `data_workorder` text DEFAULT NULL,
  `data_wo_hours` text DEFAULT NULL,
  `data_wo_localhours` text DEFAULT NULL,
  `data_wo_parts` text DEFAULT NULL,
  `data_wo_soparts` text DEFAULT NULL,
  `data_wo_report` text DEFAULT NULL,
  `data_wo_tax` text DEFAULT NULL,
  `data_wo_notes` text DEFAULT NULL,
  `is_last_revision` int(11) DEFAULT NULL,
  PRIMARY KEY (`revision_id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `wo_revisions`
--

/*!40000 ALTER TABLE `wo_revisions` DISABLE KEYS */;
INSERT INTO `wo_revisions` VALUES (1,1001,'2025-03-01 09:30:00',1,'manual','{\"id\":1001,\"status\":2}','Commande reçue partielle, reste 2 unités en reliquat.','Vérifier le câblage et la boîte de jonction avant la prochaine visite.','Luminaire extérieur remplacé, façade ô côté cour.','Luminaire extérieur remplacé, façade ô côté cour.',NULL,'1,234.50','Replaced driver and verified output on all four fixtures.',1),(2,1005,'2025-03-02 09:30:00',2,'manual',0xDEADBEEF,NULL,'','Vérifier le câblage et la boîte de jonction avant la prochaine visite.','Emergency circuit tested and tagged; report signed by site contact.','Emergency circuit tested and tagged; report signed by site contact.','0.00','Replaced driver and verified output on all four fixtures.',1);
/*!40000 ALTER TABLE `wo_revisions` ENABLE KEYS */;


--
-- Table structure for table `wo_invoiceno`
--

DROP TABLE IF EXISTS `wo_invoiceno`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `wo_invoiceno` (
  `id` int(12) NOT NULL AUTO_INCREMENT,
  `woid` int(10) NOT NULL,
  `invoiceno` varchar(120) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `wo_invoiceno`
--

/*!40000 ALTER TABLE `wo_invoiceno` DISABLE KEYS */;
INSERT INTO `wo_invoiceno` VALUES (1,1001,'SAGE-5100'),(2,1002,'SAGE-5101');
/*!40000 ALTER TABLE `wo_invoiceno` ENABLE KEYS */;


--
-- Table structure for table `wo_images_cropped`
--

DROP TABLE IF EXISTS `wo_images_cropped`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `wo_images_cropped` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `woid` int(11) DEFAULT NULL,
  `cropped_time` timestamp DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `wo_images_cropped`
--

/*!40000 ALTER TABLE `wo_images_cropped` DISABLE KEYS */;
INSERT INTO `wo_images_cropped` VALUES (1,1001,'2025-03-14 09:30:00'),(2,1002,'2025-03-15 11:05:00');
/*!40000 ALTER TABLE `wo_images_cropped` ENABLE KEYS */;


--
-- Table structure for table `localwo_cusprofile`
--

DROP TABLE IF EXISTS `localwo_cusprofile`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `localwo_cusprofile` (
  `id` int(100) NOT NULL AUTO_INCREMENT,
  `site` int(100) NOT NULL,
  `interior` text DEFAULT NULL,
  `exterior` text DEFAULT NULL,
  `mustnotes` text DEFAULT NULL,
  `codes` text DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `localwo_cusprofile`
--

/*!40000 ALTER TABLE `localwo_cusprofile` DISABLE KEYS */;
/*!40000 ALTER TABLE `localwo_cusprofile` ENABLE KEYS */;


--
-- Table structure for table `localwo_hours_change_histroy`
--

DROP TABLE IF EXISTS `localwo_hours_change_histroy`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `localwo_hours_change_histroy` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `fk_id` int(11) DEFAULT NULL,
  `woid` int(10) DEFAULT NULL,
  `date` date NOT NULL,
  `timein` time NOT NULL,
  `timeout` time NOT NULL,
  `hours` decimal(7,2) NOT NULL,
  `numtechs` int(10) NOT NULL,
  `tech` int(10) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `localwo_hours_change_histroy`
--

/*!40000 ALTER TABLE `localwo_hours_change_histroy` DISABLE KEYS */;
/*!40000 ALTER TABLE `localwo_hours_change_histroy` ENABLE KEYS */;


--
-- Table structure for table `localwo_quotes`
--

DROP TABLE IF EXISTS `localwo_quotes`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `localwo_quotes` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `woid` int(11) NOT NULL,
  `tech` varchar(100) NOT NULL,
  `datetime` varchar(100) NOT NULL,
  `report` text NOT NULL,
  `hours` varchar(100) NOT NULL,
  `numtechs` varchar(100) NOT NULL,
  `parts` text DEFAULT NULL,
  `soparts` text DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `localwo_quotes`
--

/*!40000 ALTER TABLE `localwo_quotes` DISABLE KEYS */;
/*!40000 ALTER TABLE `localwo_quotes` ENABLE KEYS */;


--
-- Table structure for table `localwo_sigs`
--

DROP TABLE IF EXISTS `localwo_sigs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `localwo_sigs` (
  `id` int(100) NOT NULL AUTO_INCREMENT,
  `woid` int(100) NOT NULL,
  `name` varchar(100) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `localwo_sigs`
--

/*!40000 ALTER TABLE `localwo_sigs` DISABLE KEYS */;
/*!40000 ALTER TABLE `localwo_sigs` ENABLE KEYS */;


--
-- Table structure for table `material_checklist`
--

DROP TABLE IF EXISTS `material_checklist`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `material_checklist` (
  `id` int(12) NOT NULL AUTO_INCREMENT,
  `workordernumber` int(11) NOT NULL,
  `quoteid` varchar(25) DEFAULT NULL,
  `sub_notes` text DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `chk_all_reviewed` int(11) NOT NULL,
  `chk_all_skids_attached` int(11) DEFAULT NULL,
  `chk_breif_walk_conducted` int(11) DEFAULT NULL,
  `is_submitted` int(11) DEFAULT NULL,
  `date_created` datetime DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `material_checklist`
--

/*!40000 ALTER TABLE `material_checklist` DISABLE KEYS */;
/*!40000 ALTER TABLE `material_checklist` ENABLE KEYS */;


--
-- Table structure for table `material_checklist_custom_entries`
--

DROP TABLE IF EXISTS `material_checklist_custom_entries`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `material_checklist_custom_entries` (
  `id` int(12) NOT NULL AUTO_INCREMENT,
  `woid` int(11) NOT NULL,
  `name` text DEFAULT NULL,
  `qty` varchar(20) DEFAULT NULL,
  `notes` text DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `material_checklist_custom_entries`
--

/*!40000 ALTER TABLE `material_checklist_custom_entries` DISABLE KEYS */;
/*!40000 ALTER TABLE `material_checklist_custom_entries` ENABLE KEYS */;


--
-- Table structure for table `material_checklist_defective_parts`
--

DROP TABLE IF EXISTS `material_checklist_defective_parts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `material_checklist_defective_parts` (
  `id` int(12) NOT NULL AUTO_INCREMENT,
  `woid` int(11) NOT NULL,
  `partno` varchar(50) NOT NULL,
  `part_description` text DEFAULT NULL,
  `qty` varchar(20) DEFAULT NULL,
  `defective_by_default` int(11) DEFAULT NULL,
  `defect_reason` varchar(80) DEFAULT NULL,
  `is_special_part` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `material_checklist_defective_parts`
--

/*!40000 ALTER TABLE `material_checklist_defective_parts` DISABLE KEYS */;
/*!40000 ALTER TABLE `material_checklist_defective_parts` ENABLE KEYS */;


--
-- Table structure for table `material_checklist_notes`
--

DROP TABLE IF EXISTS `material_checklist_notes`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `material_checklist_notes` (
  `id` int(12) NOT NULL AUTO_INCREMENT,
  `woid` int(11) NOT NULL,
  `partno` varchar(50) NOT NULL,
  `notes` text DEFAULT NULL,
  `is_special_part` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `material_checklist_notes`
--

/*!40000 ALTER TABLE `material_checklist_notes` DISABLE KEYS */;
/*!40000 ALTER TABLE `material_checklist_notes` ENABLE KEYS */;


--
-- Table structure for table `material_checklist_parts`
--

DROP TABLE IF EXISTS `material_checklist_parts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `material_checklist_parts` (
  `id` int(12) NOT NULL AUTO_INCREMENT,
  `woid` int(11) NOT NULL,
  `partno` varchar(50) DEFAULT NULL,
  `part_description` text DEFAULT NULL,
  `qty` varchar(20) DEFAULT NULL,
  `col_number` int(11) DEFAULT NULL,
  `is_special_part` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `material_checklist_parts`
--

/*!40000 ALTER TABLE `material_checklist_parts` DISABLE KEYS */;
/*!40000 ALTER TABLE `material_checklist_parts` ENABLE KEYS */;


--
-- Table structure for table `material_checklist_returning_custom_enteries`
--

DROP TABLE IF EXISTS `material_checklist_returning_custom_enteries`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `material_checklist_returning_custom_enteries` (
  `id` int(12) NOT NULL AUTO_INCREMENT,
  `woid` int(11) NOT NULL,
  `description` text DEFAULT NULL,
  `qty` varchar(20) DEFAULT NULL,
  `returning_to` enum('alliance','contractor','customer site','') DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `material_checklist_returning_custom_enteries`
--

/*!40000 ALTER TABLE `material_checklist_returning_custom_enteries` DISABLE KEYS */;
/*!40000 ALTER TABLE `material_checklist_returning_custom_enteries` ENABLE KEYS */;


--
-- Table structure for table `material_checklist_returning_parts`
--

DROP TABLE IF EXISTS `material_checklist_returning_parts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `material_checklist_returning_parts` (
  `id` int(12) NOT NULL AUTO_INCREMENT,
  `woid` int(11) NOT NULL,
  `partno` varchar(150) DEFAULT NULL,
  `part_description` text DEFAULT NULL,
  `supplied_qty` varchar(20) DEFAULT NULL,
  `qty` varchar(20) DEFAULT NULL,
  `returning_to` enum('alliance','contractor','customer site','') DEFAULT NULL,
  `is_special_part` int(11) DEFAULT NULL,
  `is_default_stock` int(11) DEFAULT NULL,
  `qty_to_alliance` varchar(20) DEFAULT NULL,
  `qty_to_customer` varchar(20) DEFAULT NULL,
  `qty_to_contractor` varchar(20) DEFAULT NULL,
  `notes` text DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `material_checklist_returning_parts`
--

/*!40000 ALTER TABLE `material_checklist_returning_parts` DISABLE KEYS */;
/*!40000 ALTER TABLE `material_checklist_returning_parts` ENABLE KEYS */;


--
-- Table structure for table `undispatched_workorders`
--

DROP TABLE IF EXISTS `undispatched_workorders`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `undispatched_workorders` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `location_id` varchar(50) DEFAULT NULL,
  `location_name` varchar(100) DEFAULT NULL,
  `site_id` int(11) DEFAULT NULL,
  `tracking_no` varchar(100) DEFAULT NULL,
  `nte` decimal(7,2) DEFAULT NULL,
  `address` varchar(100) DEFAULT NULL,
  `province` varchar(8) DEFAULT NULL,
  `city` varchar(100) DEFAULT NULL,
  `category` text DEFAULT NULL,
  `batch_id` int(11) DEFAULT NULL,
  `batch_type` varchar(20) DEFAULT NULL,
  `created_timespan` bigint(20) DEFAULT NULL,
  `is_imported` int(11) DEFAULT NULL,
  `re_updated` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `undispatched_workorders`
--

/*!40000 ALTER TABLE `undispatched_workorders` DISABLE KEYS */;
/*!40000 ALTER TABLE `undispatched_workorders` ENABLE KEYS */;


--
-- Table structure for table `customer_quote`
--

DROP TABLE IF EXISTS `customer_quote`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `customer_quote` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `workordernumber` int(11) DEFAULT NULL,
  `site` int(11) DEFAULT NULL,
  `ShipCntc` text DEFAULT NULL,
  `ShipStrt1` text DEFAULT NULL,
  `ShipStrt2` text DEFAULT NULL,
  `ShipCity` text DEFAULT NULL,
  `ShipPrvSt` text DEFAULT NULL,
  `ShipPstZp` text DEFAULT NULL,
  `is_address_updated` int(11) DEFAULT NULL,
  `report` text DEFAULT NULL,
  `status` int(11) DEFAULT NULL,
  `payment_terms` int(11) DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `appliedtaxrate` varchar(12) DEFAULT NULL,
  `tax_code` varchar(50) DEFAULT NULL,
  `tax_amount` varchar(50) DEFAULT NULL,
  `createdby` int(11) DEFAULT NULL,
  `due_date` date DEFAULT NULL,
  `is_due_date_tbd` int(11) DEFAULT NULL,
  `date_approved` date DEFAULT NULL,
  `date_created` date DEFAULT NULL,
  `is_revision` int(11) DEFAULT NULL,
  `revision_quote_id` int(11) DEFAULT NULL,
  `revision_id` float DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `customer_quote`
--

/*!40000 ALTER TABLE `customer_quote` DISABLE KEYS */;
INSERT INTO `customer_quote` VALUES (1,1001,1,'Luminaire extérieur remplacé, façade ô côté cour.','88 Queens Quay W','Suite 200','Mississauga','BC','M5H 2N2',1,'Customer approved the repair by email; completion photo attached.',3,1,'Quote approved by site contact.','13.000','HST','113.00',1,'2025-03-01',1,'2025-03-01','2025-02-01',1,1,1.00),(2,1002,2,'Commande reçue partielle, reste 2 unités en reliquat.','88 Queens Quay W',NULL,NULL,'QC','L4W 1J7',2,'Luminaire extérieur remplacé, façade ô côté cour.',2,2,'Customer approved the repair by email; completion photo attached.','13.000','HST','$1,234.50',3,NULL,2,'2025-03-02','2025-02-04',2,2,2.00),(3,1003,7,'Luminaire extérieur remplacé, façade ô côté cour.','455 Front St E',NULL,'Montréal','BC','M5A 1G1',3,'Commande reçue partielle, reste 2 unités en reliquat.',1,3,NULL,'13.000','HST','',2,'2025-03-03',3,'2025-03-03','2025-02-06',3,3,3.00),(4,1005,5,NULL,'','Suite 200','Montréal','AB',NULL,4,'Emergency circuit tested and tagged; report signed by site contact.',4,4,'Rejected: budget moved to next fiscal year.','13.000','HST','n/a',4,'2025-03-04',4,NULL,'0000-00-00',4,4,4.00),(5,0,6,'Vérifier le câblage et la boîte de jonction avant la prochaine visite.','100 Consilium Pl',NULL,'Ottawa','ON','K1P 1J1',5,'Emergency circuit tested and tagged; report signed by site contact.',1,5,'Vérifier le câblage et la boîte de jonction avant la prochaine visite.',NULL,'HST','0.00',5,'0000-00-00',NULL,'0000-00-00','2025-02-11',5,5,5.00);
/*!40000 ALTER TABLE `customer_quote` ENABLE KEYS */;


--
-- Table structure for table `customer_quote_hours`
--

DROP TABLE IF EXISTS `customer_quote_hours`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `customer_quote_hours` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `cust_qoid` int(11) NOT NULL,
  `hours` decimal(7,2) NOT NULL,
  `rate` decimal(7,2) NOT NULL,
  `date` date DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `customer_quote_hours`
--

/*!40000 ALTER TABLE `customer_quote_hours` DISABLE KEYS */;
INSERT INTO `customer_quote_hours` VALUES (1,1,1.00,12.89,'2025-03-01'),(2,2,2.00,20.14,'2025-03-02'),(3,3,3.00,27.39,'2025-03-03');
/*!40000 ALTER TABLE `customer_quote_hours` ENABLE KEYS */;


--
-- Table structure for table `customer_quote_parts`
--

DROP TABLE IF EXISTS `customer_quote_parts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `customer_quote_parts` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `cust_qoid` int(11) NOT NULL,
  `partno` varchar(20) NOT NULL,
  `qty` int(11) NOT NULL,
  `price` decimal(11,2) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `customer_quote_parts`
--

/*!40000 ALTER TABLE `customer_quote_parts` DISABLE KEYS */;
INSERT INTO `customer_quote_parts` VALUES (1,1,'CLS-1001',1,15.80),(2,2,'CLS-1002',2,23.05),(3,3,'CLS-1003',3,30.30),(4,4,'CLS-1004',4,37.55);
/*!40000 ALTER TABLE `customer_quote_parts` ENABLE KEYS */;


--
-- Table structure for table `customer_quote_soparts`
--

DROP TABLE IF EXISTS `customer_quote_soparts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `customer_quote_soparts` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `cust_qoid` int(11) NOT NULL,
  `name` varchar(150) NOT NULL,
  `qty` int(11) NOT NULL,
  `price` decimal(11,2) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `customer_quote_soparts`
--

/*!40000 ALTER TABLE `customer_quote_soparts` DISABLE KEYS */;
INSERT INTO `customer_quote_soparts` VALUES (1,1,'Frank Zito',1,15.80),(2,2,'Sophie Dubé',2,23.05),(3,3,'Bill Okafor',3,30.30);
/*!40000 ALTER TABLE `customer_quote_soparts` ENABLE KEYS */;


--
-- Table structure for table `customer_qo_packing_slip`
--

DROP TABLE IF EXISTS `customer_qo_packing_slip`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `customer_qo_packing_slip` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `cust_qoid` int(11) NOT NULL,
  `date_created` date DEFAULT NULL,
  `ship_date` date DEFAULT NULL,
  `packing_slip_level` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `customer_qo_packing_slip`
--

/*!40000 ALTER TABLE `customer_qo_packing_slip` DISABLE KEYS */;
INSERT INTO `customer_qo_packing_slip` VALUES (1,1,'2025-03-01','2025-03-01',1),(2,2,'2025-03-02','2025-03-02',2);
/*!40000 ALTER TABLE `customer_qo_packing_slip` ENABLE KEYS */;


--
-- Table structure for table `customer_qo_packing_parts`
--

DROP TABLE IF EXISTS `customer_qo_packing_parts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `customer_qo_packing_parts` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `cust_qoid` int(11) DEFAULT NULL,
  `packing_slip_id` int(11) NOT NULL,
  `partno` varchar(20) NOT NULL,
  `actual_qty` int(11) DEFAULT NULL,
  `backorder_qty` int(11) NOT NULL,
  `shipped_qty` int(11) DEFAULT NULL,
  `sortorder` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `customer_qo_packing_parts`
--

/*!40000 ALTER TABLE `customer_qo_packing_parts` DISABLE KEYS */;
INSERT INTO `customer_qo_packing_parts` VALUES (1,1,1,'CLS-1001',1,1,1,1),(2,2,2,'CLS-1002',2,2,2,2),(3,3,1,'CLS-1003',3,3,3,3);
/*!40000 ALTER TABLE `customer_qo_packing_parts` ENABLE KEYS */;


--
-- Table structure for table `standalone_quote`
--

DROP TABLE IF EXISTS `standalone_quote`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `standalone_quote` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `workordernumber` int(11) DEFAULT NULL,
  `site` int(11) DEFAULT NULL,
  `ShipCntc` text DEFAULT NULL,
  `ShipStrt1` text DEFAULT NULL,
  `ShipStrt2` text DEFAULT NULL,
  `ShipCity` text DEFAULT NULL,
  `ShipPrvSt` text DEFAULT NULL,
  `ShipPstZp` text DEFAULT NULL,
  `is_address_updated` int(11) DEFAULT NULL,
  `pdf_notes` text DEFAULT NULL,
  `status` int(11) DEFAULT NULL,
  `reference_wo_number` varchar(25) DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `appliedtaxrate` varchar(12) DEFAULT NULL,
  `tax_code` varchar(50) DEFAULT NULL,
  `tax_amount` varchar(50) DEFAULT NULL,
  `createdby` int(11) DEFAULT NULL,
  `date_approved` date DEFAULT NULL,
  `date_created` date DEFAULT NULL,
  `is_revision` int(11) DEFAULT NULL,
  `revision_quote_id` int(11) DEFAULT NULL,
  `revision_id` float DEFAULT NULL,
  `created_from_local` int(11) DEFAULT NULL,
  `is_deleted` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `standalone_quote`
--

/*!40000 ALTER TABLE `standalone_quote` DISABLE KEYS */;
INSERT INTO `standalone_quote` VALUES (1,NULL,1,NULL,'199 Bay St','Suite 200','Sudbury','BC','H2R 2W3',1,'Luminaire extérieur remplacé, façade ô côté cour.',1,1001,'Luminaire extérieur remplacé, façade ô côté cour.','13.000','HST','0.00',1,'2025-03-01',NULL,1,1,1.00,1,1),(2,NULL,2,NULL,'12 King St W',NULL,'Montréal','QC','K1P 1J1',2,'Replaced driver and verified output on all four fixtures.',2,1002,'Vérifier le câblage et la boîte de jonction avant la prochaine visite.','13.000','HST','410.00',2,'2025-03-02','2025-03-02',2,NULL,2.00,2,2),(3,1003,3,'Replaced driver and verified output on all four fixtures.','201 Portage Ave',NULL,'Sudbury','BC','P3C 5R4',3,'Luminaire extérieur remplacé, façade ô côté cour.',3,1003,'Commande reçue partielle, reste 2 unités en reliquat.','13.000',NULL,NULL,3,'2025-03-03','2025-03-03',3,3,3.00,3,3);
/*!40000 ALTER TABLE `standalone_quote` ENABLE KEYS */;


--
-- Table structure for table `standalone_quote_hours`
--

DROP TABLE IF EXISTS `standalone_quote_hours`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `standalone_quote_hours` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `sal_qoid` int(11) NOT NULL,
  `hours` decimal(7,2) NOT NULL,
  `numtechs` int(11) DEFAULT NULL,
  `rate` decimal(7,2) NOT NULL,
  `date` date DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `standalone_quote_hours`
--

/*!40000 ALTER TABLE `standalone_quote_hours` DISABLE KEYS */;
INSERT INTO `standalone_quote_hours` VALUES (1,1,1.00,1,12.89,'2025-03-01'),(2,2,2.00,2,20.14,'2025-03-02');
/*!40000 ALTER TABLE `standalone_quote_hours` ENABLE KEYS */;


--
-- Table structure for table `standalone_quote_parts`
--

DROP TABLE IF EXISTS `standalone_quote_parts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `standalone_quote_parts` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `sal_qoid` int(11) NOT NULL,
  `partno` varchar(20) NOT NULL,
  `qty` int(11) NOT NULL,
  `entered_price` varchar(30) DEFAULT NULL,
  `price` decimal(10,2) DEFAULT NULL,
  `is_under_warranty` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `standalone_quote_parts`
--

/*!40000 ALTER TABLE `standalone_quote_parts` DISABLE KEYS */;
INSERT INTO `standalone_quote_parts` VALUES (1,1,'CLS-1001',1,NULL,15.80,1),(2,2,'CLS-1002',2,'$95.00',23.05,2),(3,3,'CLS-1003',3,'1,234.50',30.30,3);
/*!40000 ALTER TABLE `standalone_quote_parts` ENABLE KEYS */;


--
-- Table structure for table `standalone_quote_soparts`
--

DROP TABLE IF EXISTS `standalone_quote_soparts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `standalone_quote_soparts` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `sal_qoid` int(11) NOT NULL,
  `name` varchar(150) NOT NULL,
  `qty` int(11) NOT NULL,
  `entered_price` varchar(30) DEFAULT NULL,
  `price` decimal(10,2) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `standalone_quote_soparts`
--

/*!40000 ALTER TABLE `standalone_quote_soparts` DISABLE KEYS */;
INSERT INTO `standalone_quote_soparts` VALUES (1,1,'Frank Zito',1,'0.00',15.80),(2,2,'Bill Okafor',2,'0.00',23.05);
/*!40000 ALTER TABLE `standalone_quote_soparts` ENABLE KEYS */;


--
-- Table structure for table `rejected_quotes`
--

DROP TABLE IF EXISTS `rejected_quotes`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `rejected_quotes` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `woid` int(11) NOT NULL,
  `date_rejected` int(11) NOT NULL,
  `rejected_reason` text DEFAULT NULL,
  `quote_content` longtext DEFAULT NULL,
  `rejected_by_detail` varchar(200) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `rejected_quotes`
--

/*!40000 ALTER TABLE `rejected_quotes` DISABLE KEYS */;
INSERT INTO `rejected_quotes` VALUES (1,1001,1,'Luminaire extérieur remplacé, façade ô côté cour.','Replaced driver and verified output on all four fixtures.','Maintenance'),(2,1002,2,'Emergency circuit tested and tagged; report signed by site contact.','Customer approved the repair by email; completion photo attached.','Maintenance');
/*!40000 ALTER TABLE `rejected_quotes` ENABLE KEYS */;


--
-- Table structure for table `customer_quote_payterms`
--

DROP TABLE IF EXISTS `customer_quote_payterms`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `customer_quote_payterms` (
  `id` tinyint(1) NOT NULL AUTO_INCREMENT,
  `name` varchar(25) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `customer_quote_payterms`
--

/*!40000 ALTER TABLE `customer_quote_payterms` DISABLE KEYS */;
/*!40000 ALTER TABLE `customer_quote_payterms` ENABLE KEYS */;


--
-- Table structure for table `customer_qo_packing_soparts`
--

DROP TABLE IF EXISTS `customer_qo_packing_soparts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `customer_qo_packing_soparts` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `cust_qoid` int(11) DEFAULT NULL,
  `packing_slip_id` int(11) NOT NULL,
  `qo_sopart_id` int(11) DEFAULT NULL,
  `name` varchar(150) NOT NULL,
  `actual_qty` int(11) DEFAULT NULL,
  `backorder_qty` int(11) NOT NULL,
  `shipped_qty` int(11) DEFAULT NULL,
  `sortorder` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `customer_qo_packing_soparts`
--

/*!40000 ALTER TABLE `customer_qo_packing_soparts` DISABLE KEYS */;
/*!40000 ALTER TABLE `customer_qo_packing_soparts` ENABLE KEYS */;


--
-- Table structure for table `quote_hours`
--

DROP TABLE IF EXISTS `quote_hours`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `quote_hours` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `woid` int(11) NOT NULL,
  `rate` int(11) NOT NULL,
  `hours` decimal(7,2) NOT NULL,
  `hourly_rate` decimal(7,2) DEFAULT NULL,
  `date` date DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `quote_hours`
--

/*!40000 ALTER TABLE `quote_hours` DISABLE KEYS */;
/*!40000 ALTER TABLE `quote_hours` ENABLE KEYS */;


--
-- Table structure for table `quote_hours_incurred`
--

DROP TABLE IF EXISTS `quote_hours_incurred`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `quote_hours_incurred` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `woid` int(11) NOT NULL,
  `rate` int(11) NOT NULL,
  `hours` decimal(7,2) NOT NULL,
  `hourly_rate` decimal(7,2) DEFAULT NULL,
  `date` date DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `quote_hours_incurred`
--

/*!40000 ALTER TABLE `quote_hours_incurred` DISABLE KEYS */;
/*!40000 ALTER TABLE `quote_hours_incurred` ENABLE KEYS */;


--
-- Table structure for table `quote_parts`
--

DROP TABLE IF EXISTS `quote_parts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `quote_parts` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `woid` int(11) NOT NULL,
  `partno` varchar(20) NOT NULL,
  `qty` int(11) NOT NULL,
  `price` decimal(11,2) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `quote_parts`
--

/*!40000 ALTER TABLE `quote_parts` DISABLE KEYS */;
/*!40000 ALTER TABLE `quote_parts` ENABLE KEYS */;


--
-- Table structure for table `quote_parts_incurred`
--

DROP TABLE IF EXISTS `quote_parts_incurred`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `quote_parts_incurred` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `woid` int(11) NOT NULL,
  `partno` varchar(20) NOT NULL,
  `qty` int(11) NOT NULL,
  `price` decimal(7,2) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `quote_parts_incurred`
--

/*!40000 ALTER TABLE `quote_parts_incurred` DISABLE KEYS */;
/*!40000 ALTER TABLE `quote_parts_incurred` ENABLE KEYS */;


--
-- Table structure for table `quote_report`
--

DROP TABLE IF EXISTS `quote_report`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `quote_report` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `woid` int(11) NOT NULL,
  `report` text NOT NULL,
  `date` timestamp DEFAULT NULL,
  `tax` decimal(7,2) DEFAULT NULL,
  `tax_code` varchar(10) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `quote_report`
--

/*!40000 ALTER TABLE `quote_report` DISABLE KEYS */;
/*!40000 ALTER TABLE `quote_report` ENABLE KEYS */;


--
-- Table structure for table `quote_soparts`
--

DROP TABLE IF EXISTS `quote_soparts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `quote_soparts` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `woid` int(11) NOT NULL,
  `name` varchar(50) NOT NULL,
  `qty` int(11) NOT NULL,
  `price` decimal(11,2) NOT NULL,
  `is_emergency_lighting` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `quote_soparts`
--

/*!40000 ALTER TABLE `quote_soparts` DISABLE KEYS */;
/*!40000 ALTER TABLE `quote_soparts` ENABLE KEYS */;


--
-- Table structure for table `quote_soparts_incurred`
--

DROP TABLE IF EXISTS `quote_soparts_incurred`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `quote_soparts_incurred` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `woid` int(11) NOT NULL,
  `name` varchar(50) NOT NULL,
  `qty` int(11) NOT NULL,
  `price` decimal(7,2) NOT NULL,
  `is_emergency_lighting` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `quote_soparts_incurred`
--

/*!40000 ALTER TABLE `quote_soparts_incurred` DISABLE KEYS */;
/*!40000 ALTER TABLE `quote_soparts_incurred` ENABLE KEYS */;


--
-- Table structure for table `calcquote_hours`
--

DROP TABLE IF EXISTS `calcquote_hours`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `calcquote_hours` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `woid` int(11) NOT NULL,
  `hours` decimal(7,2) NOT NULL,
  `rate` decimal(7,2) NOT NULL,
  `entered_rate` varchar(15) DEFAULT NULL,
  `numtechs` int(11) DEFAULT NULL,
  `date` date DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `calcquote_hours`
--

/*!40000 ALTER TABLE `calcquote_hours` DISABLE KEYS */;
/*!40000 ALTER TABLE `calcquote_hours` ENABLE KEYS */;


--
-- Table structure for table `calcquote_hours_incurred`
--

DROP TABLE IF EXISTS `calcquote_hours_incurred`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `calcquote_hours_incurred` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `woid` int(11) NOT NULL,
  `hours` decimal(7,2) NOT NULL,
  `rate` decimal(7,2) NOT NULL,
  `entered_rate` varchar(15) DEFAULT NULL,
  `date` date DEFAULT NULL,
  `numtechs` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `calcquote_hours_incurred`
--

/*!40000 ALTER TABLE `calcquote_hours_incurred` DISABLE KEYS */;
/*!40000 ALTER TABLE `calcquote_hours_incurred` ENABLE KEYS */;


--
-- Table structure for table `calcquote_incurred`
--

DROP TABLE IF EXISTS `calcquote_incurred`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `calcquote_incurred` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `woid` int(11) NOT NULL,
  `name` varchar(100) DEFAULT NULL,
  `incurred_cost` decimal(7,2) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `calcquote_incurred`
--

/*!40000 ALTER TABLE `calcquote_incurred` DISABLE KEYS */;
/*!40000 ALTER TABLE `calcquote_incurred` ENABLE KEYS */;


--
-- Table structure for table `calcquote_parts`
--

DROP TABLE IF EXISTS `calcquote_parts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `calcquote_parts` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `woid` int(11) NOT NULL,
  `partno` varchar(20) NOT NULL,
  `qty` int(11) NOT NULL,
  `price` decimal(11,2) NOT NULL,
  `entered_price` varchar(15) DEFAULT NULL,
  `is_under_warranty` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `calcquote_parts`
--

/*!40000 ALTER TABLE `calcquote_parts` DISABLE KEYS */;
/*!40000 ALTER TABLE `calcquote_parts` ENABLE KEYS */;


--
-- Table structure for table `calcquote_parts_incurred`
--

DROP TABLE IF EXISTS `calcquote_parts_incurred`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `calcquote_parts_incurred` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `woid` int(11) NOT NULL,
  `partno` varchar(20) NOT NULL,
  `qty` int(11) NOT NULL,
  `price` decimal(11,2) NOT NULL,
  `entered_price` varchar(15) DEFAULT NULL,
  `is_under_warranty` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `calcquote_parts_incurred`
--

/*!40000 ALTER TABLE `calcquote_parts_incurred` DISABLE KEYS */;
/*!40000 ALTER TABLE `calcquote_parts_incurred` ENABLE KEYS */;


--
-- Table structure for table `calcquote_report`
--

DROP TABLE IF EXISTS `calcquote_report`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `calcquote_report` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `woid` int(11) NOT NULL,
  `report` text NOT NULL,
  `incurred_report` text DEFAULT NULL,
  `status` varchar(20) NOT NULL,
  `date` date NOT NULL,
  `tax` decimal(7,2) NOT NULL,
  `incurred` decimal(7,2) DEFAULT NULL,
  `is_sub_quote` tinyint(4) DEFAULT NULL,
  `taxcode` varchar(15) DEFAULT NULL,
  `add_province_taxcode` varchar(30) DEFAULT NULL,
  `is_calculated` int(3) DEFAULT NULL,
  `is_after_two_cent` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `calcquote_report`
--

/*!40000 ALTER TABLE `calcquote_report` DISABLE KEYS */;
/*!40000 ALTER TABLE `calcquote_report` ENABLE KEYS */;


--
-- Table structure for table `calcquote_soparts`
--

DROP TABLE IF EXISTS `calcquote_soparts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `calcquote_soparts` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `woid` int(11) NOT NULL,
  `name` varchar(250) NOT NULL,
  `qty` int(11) NOT NULL,
  `price` decimal(12,2) NOT NULL,
  `entered_price` varchar(15) DEFAULT NULL,
  `is_emergency_lighting` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `calcquote_soparts`
--

/*!40000 ALTER TABLE `calcquote_soparts` DISABLE KEYS */;
/*!40000 ALTER TABLE `calcquote_soparts` ENABLE KEYS */;


--
-- Table structure for table `calcquote_soparts_incurred`
--

DROP TABLE IF EXISTS `calcquote_soparts_incurred`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `calcquote_soparts_incurred` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `woid` int(11) NOT NULL,
  `name` varchar(250) NOT NULL,
  `qty` int(11) NOT NULL,
  `price` decimal(10,2) NOT NULL,
  `entered_price` varchar(15) DEFAULT NULL,
  `is_emergency_lighting` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `calcquote_soparts_incurred`
--

/*!40000 ALTER TABLE `calcquote_soparts_incurred` DISABLE KEYS */;
/*!40000 ALTER TABLE `calcquote_soparts_incurred` ENABLE KEYS */;


--
-- Table structure for table `purchaseorder`
--

DROP TABLE IF EXISTS `purchaseorder`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `purchaseorder` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `purchase_order_number` varchar(20) DEFAULT NULL,
  `invoice_number` varchar(50) DEFAULT NULL,
  `supplier_id` int(11) DEFAULT NULL,
  `sub_supplier_id` int(11) DEFAULT NULL,
  `cust_qoid` int(11) DEFAULT NULL,
  `tjx_quoteid` int(11) DEFAULT NULL,
  `pre_poid` int(11) DEFAULT NULL,
  `sup_poid` int(11) DEFAULT NULL,
  `req_qoid` int(11) DEFAULT NULL,
  `sup_qoid` int(11) DEFAULT NULL,
  `status` int(11) DEFAULT NULL,
  `status_on_july_21_2025` int(11) DEFAULT NULL,
  `priority` int(11) DEFAULT NULL,
  `supplier_notes` text DEFAULT NULL,
  `notes` longtext DEFAULT NULL,
  `expdeliverydate` date DEFAULT NULL,
  `tax_code` varchar(50) DEFAULT NULL,
  `appliedtaxrate` varchar(12) DEFAULT NULL,
  `fob` text DEFAULT NULL,
  `pay_terms` text DEFAULT NULL,
  `ship_address_contactname` text DEFAULT NULL,
  `ship_address_company` text DEFAULT NULL,
  `ship_address_street1` text DEFAULT NULL,
  `ship_address_street2` text DEFAULT NULL,
  `ship_address_city` text DEFAULT NULL,
  `ship_address_province` text DEFAULT NULL,
  `ship_address_postalcode` text DEFAULT NULL,
  `ship_address_phone` text DEFAULT NULL,
  `shipping_address` text DEFAULT NULL,
  `securitycode` varchar(50) DEFAULT NULL,
  `shipping_code` varchar(50) DEFAULT NULL,
  `ship_via` varchar(50) DEFAULT NULL,
  `createdby` int(11) DEFAULT NULL,
  `is_marked_critical` int(11) DEFAULT NULL,
  `is_submitted` int(11) DEFAULT NULL,
  `completiondate` int(11) DEFAULT NULL,
  `date_created` datetime DEFAULT NULL,
  `date_completed` datetime DEFAULT NULL,
  `po_folder_attach_path` varchar(200) DEFAULT NULL,
  `is_online_vendor_order` int(11) DEFAULT NULL,
  `stock_updated` int(11) DEFAULT NULL,
  `revision_no` int(11) DEFAULT NULL,
  `is_type_maintenance` int(11) DEFAULT NULL,
  `shipment_type` enum('alliance','cls','alliancepickup','clspickup','contractor','customer','subcontractor','clscustomer','alliancemaintenance','') DEFAULT NULL,
  `shipment_type_correction` varchar(30) DEFAULT NULL,
  `shipment_type_bkup_18july2025` varchar(30) DEFAULT NULL,
  `customerid` int(11) DEFAULT NULL,
  `subcontractorid` int(11) DEFAULT NULL,
  `is_alliance_stocktransfer_po` int(11) DEFAULT NULL,
  `trackingid` varchar(50) DEFAULT NULL,
  `print_records_per_page` int(11) DEFAULT NULL,
  `tjx_parts_qty_type` varchar(15) DEFAULT NULL,
  `is_approved` int(11) DEFAULT NULL,
  `override_supplier_is_under` enum('','alliance','cls','maintenance') DEFAULT NULL,
  `transferring_from_type` enum('alliance','cls','alliancepickup','clspickup','contractor','customer','subcontractor','clscustomer','alliancemaintenance','') DEFAULT NULL,
  `is_alliance_stocktransfer_po_old` int(11) DEFAULT NULL,
  `from_subcontractorid` int(11) DEFAULT NULL,
  `from_customerid` int(11) DEFAULT NULL,
  `transfer_from_contactname` varchar(50) DEFAULT NULL,
  `transfer_from_company` varchar(50) DEFAULT NULL,
  `transfer_from_street1` varchar(100) DEFAULT NULL,
  `transfer_from_street2` varchar(100) DEFAULT NULL,
  `transfer_from_city` varchar(20) DEFAULT NULL,
  `transfer_from_province` varchar(15) DEFAULT NULL,
  `transfer_from_postalcode` varchar(15) DEFAULT NULL,
  `transfer_from_phone` varchar(30) DEFAULT NULL,
  `transfer_from_address` text DEFAULT NULL,
  `transfer_came_from_poid` int(11) DEFAULT NULL,
  `po_submitted_by` varchar(15) DEFAULT NULL,
  `approval_request_by` int(11) DEFAULT NULL,
  `last_status` int(11) DEFAULT NULL,
  `status_changed_date` timestamp DEFAULT NULL,
  `last_followup_reminder_date` date DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `purchaseorder`
--

/*!40000 ALTER TABLE `purchaseorder` DISABLE KEYS */;
INSERT INTO `purchaseorder` VALUES (1,'PO-2001','INV-4100',1,1,1,1,1,1,1,1,4,1,2,'Commande reçue partielle, reste 2 unités en reliquat.','','2025-03-01','HST','13.000','FOB Destination','Net 30','Customer approved the repair by email; completion photo attached.','Vérifier le câblage et la boîte de jonction avant la prochaine visite.','Replaced driver and verified output on all four fixtures.','Replaced driver and verified output on all four fixtures.','',NULL,'Vérifier le câblage et la boîte de jonction avant la prochaine visite.','514-555-0198','Customer approved the repair by email; completion photo attached.','SC-4000','PICKUP','Purolator',1,1,1,NULL,'2025-02-01 09:00:00','2025-03-01 09:30:00','Standard',1,1,1,1,'contractor','alliance','alliance',1,1,1,'',1,'each',1,'cls','clspickup',1,1,1,'North',NULL,'199 Bay St','Suite 200','Montréal','AB','P3C 5R4','514-555-0198','Replaced driver and verified output on all four fixtures.',1,NULL,1,1,'2025-03-01 09:30:00','2025-03-01'),(2,'PO-2002','INV-4101',2,NULL,2,2,2,2,2,2,3,2,1,'Vérifier le câblage et la boîte de jonction avant la prochaine visite.','Emergency circuit tested and tagged; report signed by site contact.','2025-03-02','HST','13.000','','Net 30','Commande reçue partielle, reste 2 unités en reliquat.','Customer approved the repair by email; completion photo attached.','Luminaire extérieur remplacé, façade ô côté cour.',NULL,NULL,'Emergency circuit tested and tagged; report signed by site contact.','Vérifier le câblage et la boîte de jonction avant la prochaine visite.','416-555-0110','','SC-4001','PICKUP','Purolator',3,2,2,2,'2025-02-03 10:30:00','2025-03-02 09:30:00',NULL,2,2,2,2,'cls','cls','cls',2,2,2,'1Z100001',2,'each',2,'maintenance','alliancemaintenance',2,2,2,'Maintenance','Café Nord Éclairage','12 King St W',NULL,NULL,'QC',NULL,'204-555-0123',NULL,2,'jsmith',2,2,'2025-03-02 09:30:00','2025-03-02'),(3,'PO-2003','INV-4102',3,3,3,3,3,3,1,3,5,3,3,'Luminaire extérieur remplacé, façade ô côté cour.','Commande reçue partielle, reste 2 unités en reliquat.','2025-03-03','HST','13.000','FOB Destination','Net 30','Luminaire extérieur remplacé, façade ô côté cour.','Customer approved the repair by email; completion photo attached.','Replaced driver and verified output on all four fixtures.','Replaced driver and verified output on all four fixtures.','Replaced driver and verified output on all four fixtures.','Emergency circuit tested and tagged; report signed by site contact.','Emergency circuit tested and tagged; report signed by site contact.','613-555-0177','Commande reçue partielle, reste 2 unités en reliquat.','SC-4002',NULL,'Purolator',2,3,3,3,'2025-02-05 14:15:00','2025-03-03 09:30:00','Exterior',3,NULL,3,3,'contractor','customer','customer',3,3,3,NULL,3,'each',3,'maintenance','clscustomer',3,3,3,'CLS','Hydro One Networks','',NULL,'Montréal','MB','M5H 2N2','905-555-0142','Emergency circuit tested and tagged; report signed by site contact.',3,'jsmith',NULL,3,'2025-03-03 09:30:00','2025-03-03'),(4,'PO-2004','INV-4103',4,4,4,4,4,4,2,NULL,2,4,1,'Emergency circuit tested and tagged; report signed by site contact.','Customer approved the repair by email; completion photo attached.','2025-03-04','HST','13.000','FOB Destination','Net 30','Emergency circuit tested and tagged; report signed by site contact.','Emergency circuit tested and tagged; report signed by site contact.','Replaced driver and verified output on all four fixtures.','Emergency circuit tested and tagged; report signed by site contact.','Customer approved the repair by email; completion photo attached.','','Customer approved the repair by email; completion photo attached.','416-555-0110','Vérifier le câblage et la boîte de jonction avant la prochaine visite.','SC-4003','','Purolator',5,4,4,4,'2025-02-07 08:45:00','2025-03-04 09:30:00','Scheduled',4,4,4,4,'alliancepickup','alliance','alliance',4,4,4,'1Z100003',4,'each',4,'alliance','cls',4,4,NULL,'Interior','Café Nord Éclairage','5650 Rue Hochelaga','Suite 200','Ottawa','MB','K1P 1J1','905-555-0142','Customer approved the repair by email; completion photo attached.',4,'jsmith',4,4,'2025-03-04 09:30:00','2025-03-04'),(5,'PO-2005','INV-4104',1,1,5,5,5,5,1,5,1,1,2,'Vérifier le câblage et la boîte de jonction avant la prochaine visite.','Customer approved the repair by email; completion photo attached.','0000-00-00',NULL,'13.000','FOB Destination','Net 30','Commande reçue partielle, reste 2 unités en reliquat.','Emergency circuit tested and tagged; report signed by site contact.','Luminaire extérieur remplacé, façade ô côté cour.','Luminaire extérieur remplacé, façade ô côté cour.',NULL,'Vérifier le câblage et la boîte de jonction avant la prochaine visite.','Replaced driver and verified output on all four fixtures.','204-555-0123','Customer approved the repair by email; completion photo attached.','SC-4004','PICKUP','Purolator',1,NULL,5,5,'2025-02-09 11:20:00','2025-03-05 09:30:00','Standard',5,NULL,1,5,'alliance','cls','cls',5,5,5,'1Z100004',NULL,'each',NULL,'maintenance','cls',5,5,5,'Pending','Menkes Developments','199 Bay St',NULL,'Ottawa','MB','H2R 2W3','514-555-0198','Vérifier le câblage et la boîte de jonction avant la prochaine visite.',5,'jsmith',5,1,'2025-03-05 09:30:00','0000-00-00'),(6,'PO-2006','INV-4105',2,NULL,1,6,6,6,2,6,4,2,1,'Emergency circuit tested and tagged; report signed by site contact.',NULL,'2025-03-06',NULL,'13.000','FOB Destination','Net 30',NULL,'Customer approved the repair by email; completion photo attached.','Emergency circuit tested and tagged; report signed by site contact.','','Vérifier le câblage et la boîte de jonction avant la prochaine visite.','Customer approved the repair by email; completion photo attached.','Commande reçue partielle, reste 2 unités en reliquat.',NULL,'Commande reçue partielle, reste 2 unités en reliquat.','SC-4005','PICKUP','Purolator',3,6,6,6,'2025-02-11 13:05:00','2025-03-06 09:30:00','Pending',6,6,2,6,'subcontractor','customer','customer',6,1,6,'',6,'each',6,'cls','alliance',6,1,6,'North','Hydro One Networks',NULL,NULL,'Montréal','ON','P3C 5R4','204-555-0123','',6,'jsmith',NULL,2,'2025-03-06 09:30:00','2025-03-06'),(7,'PO-2007','INV-4106',3,3,2,NULL,7,7,1,NULL,3,3,3,'Replaced driver and verified output on all four fixtures.','Replaced driver and verified output on all four fixtures.','2025-03-07','HST','13.000','FOB Destination','Net 30','Customer approved the repair by email; completion photo attached.','Replaced driver and verified output on all four fixtures.','Luminaire extérieur remplacé, façade ô côté cour.','Replaced driver and verified output on all four fixtures.','Customer approved the repair by email; completion photo attached.','','','514-555-0198','Commande reçue partielle, reste 2 unités en reliquat.','SC-4006','PICKUP','Purolator',4,7,7,7,'2025-02-13 15:40:00','2025-03-07 09:30:00','Maintenance',7,7,3,7,'alliancemaintenance','alliance','alliance',1,2,7,'1Z100006',7,'each',7,'alliance','alliancepickup',7,2,1,'North','Tridel Corporation','5650 Rue Hochelaga','Suite 200','Montréal','AB','M5A 1G1','613-555-0177','Replaced driver and verified output on all four fixtures.',7,'jsmith',7,3,'2025-03-07 09:30:00','2025-03-07'),(8,'PO-2008','INV-4107',4,4,3,8,8,8,2,8,1,4,1,'Luminaire extérieur remplacé, façade ô côté cour.',NULL,'2025-03-08','HST','13.000',NULL,'Net 30','Luminaire extérieur remplacé, façade ô côté cour.','Luminaire extérieur remplacé, façade ô côté cour.','Vérifier le câblage et la boîte de jonction avant la prochaine visite.','Customer approved the repair by email; completion photo attached.',NULL,'Commande reçue partielle, reste 2 unités en reliquat.','Customer approved the repair by email; completion photo attached.','905-555-0142','Customer approved the repair by email; completion photo attached.','SC-4007','PICKUP','Purolator',5,8,8,NULL,'2025-02-15 07:55:00','2025-03-08 09:30:00','',8,8,4,8,'clspickup','cls',NULL,2,3,8,'1Z100007',8,'each',8,'cls','clspickup',8,NULL,2,'Scheduled','Alliance Lighting Inc.','199 Bay St',NULL,'Mississauga','AB','M5H 2N2','905-555-0142','Replaced driver and verified output on all four fixtures.',8,'jsmith',8,4,NULL,'2025-03-08');
/*!40000 ALTER TABLE `purchaseorder` ENABLE KEYS */;


--
-- Table structure for table `po_parts`
--

DROP TABLE IF EXISTS `po_parts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `po_parts` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `poid` int(11) NOT NULL,
  `partno` varchar(100) NOT NULL,
  `qty` decimal(7,2) DEFAULT NULL,
  `qty_received` decimal(7,2) DEFAULT NULL,
  `price` varchar(20) DEFAULT NULL,
  `model_number` varchar(150) DEFAULT NULL,
  `none_customer_invoice_item` int(11) DEFAULT NULL,
  `item_transferfrom_type` varchar(50) DEFAULT NULL,
  `item_transferfrom_type_number` varchar(50) DEFAULT NULL,
  `item_purchase_type` varchar(50) DEFAULT NULL,
  `item_purchase_type_number` varchar(50) DEFAULT NULL,
  `under_warranty` int(11) DEFAULT NULL,
  `do_not_deduct_from` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `po_parts`
--

/*!40000 ALTER TABLE `po_parts` DISABLE KEYS */;
INSERT INTO `po_parts` VALUES (1,1,'CLS-1001',2.00,2.00,'45.00','MOD-6622',1,'workorder','1001','workorder','1001',1,1),(2,1,'CLS-1002',1.00,0.00,'','MOD-2095',2,NULL,'1002',NULL,'1002',2,2),(3,2,'CLS-1003',4.00,4.00,'$1,234.50','MOD-4410',3,'cls','1003','cls','1003',3,3),(4,2,'CLS-1004',3.00,1.00,'n/a','MOD-7781',4,'projectpo','1004','','1004',4,4),(5,3,'CLS-1005',2.00,5.00,'9.99','MOD-4410',5,'workorder','1005','workorder','1005',5,5),(6,4,'CLS-1006',6.00,6.00,'18.40','MOD-1190',6,'stock','1006','stock','1006',6,6),(7,5,'CLS-1007',2.00,0.00,'7.25','MOD-6622',7,'cls',NULL,'cls','1007',7,7),(8,6,'CLS-1008',1.00,1.00,'12.75','MOD-6622',8,'projectpo',NULL,'projectpo','1008',8,8),(9,7,'CLS-1009',12.00,10.00,'3.40','MOD-6622',NULL,'workorder','1009','workorder','1009',9,9),(10,8,'---',1.00,0.00,'','MOD-1190',1,'stock',NULL,'stock','1001',1,1);
/*!40000 ALTER TABLE `po_parts` ENABLE KEYS */;


--
-- Table structure for table `po_soparts`
--

DROP TABLE IF EXISTS `po_soparts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `po_soparts` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `poid` int(11) NOT NULL,
  `name` varchar(200) NOT NULL,
  `qty` decimal(7,2) DEFAULT NULL,
  `qty_received` decimal(7,2) DEFAULT NULL,
  `price` varchar(20) DEFAULT NULL,
  `model_number` varchar(150) DEFAULT NULL,
  `none_customer_invoice_item` int(11) DEFAULT NULL,
  `item_transferfrom_type` varchar(50) DEFAULT NULL,
  `item_transferfrom_type_number` varchar(50) DEFAULT NULL,
  `item_purchase_type` varchar(50) DEFAULT NULL,
  `item_purchase_type_number` varchar(50) DEFAULT NULL,
  `do_not_deduct_from` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `po_soparts`
--

/*!40000 ALTER TABLE `po_soparts` DISABLE KEYS */;
INSERT INTO `po_soparts` VALUES (1,1,'Bill Okafor',NULL,1.00,'0.00','MOD-7781',1,'workorder','1001','workorder','1001',1),(2,2,'Derek Chan',2.00,2.00,'','MOD-2095',2,'stock','','stock','1002',2),(3,3,'Derek Chan',3.00,3.00,'1,234.50','MOD-6622',3,'cls','1003','cls','1003',NULL),(4,4,'Priya Raman',4.00,4.00,NULL,'MOD-4410',4,'projectpo','1004','projectpo',NULL,4);
/*!40000 ALTER TABLE `po_soparts` ENABLE KEYS */;


--
-- Table structure for table `po_preorder`
--

DROP TABLE IF EXISTS `po_preorder`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `po_preorder` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `cust_qoid` int(11) DEFAULT NULL,
  `report` text DEFAULT NULL,
  `status` int(11) DEFAULT NULL,
  `priority` int(11) DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `is_without_quote` int(11) DEFAULT NULL,
  `workordernumber` varchar(50) DEFAULT NULL,
  `createdby` int(11) DEFAULT NULL,
  `date_received` date DEFAULT NULL,
  `date_created` date DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `po_preorder`
--

/*!40000 ALTER TABLE `po_preorder` DISABLE KEYS */;
INSERT INTO `po_preorder` VALUES (1,1,'Commande reçue partielle, reste 2 unités en reliquat.',1,1,'',1,1001,1,'2025-03-01','2025-03-01'),(2,2,'Vérifier le câblage et la boîte de jonction avant la prochaine visite.',NULL,2,'',2,1002,2,'2025-03-02','2025-03-02');
/*!40000 ALTER TABLE `po_preorder` ENABLE KEYS */;


--
-- Table structure for table `po_preorder_parts`
--

DROP TABLE IF EXISTS `po_preorder_parts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `po_preorder_parts` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `pre_poid` int(11) NOT NULL,
  `partno` varchar(20) NOT NULL,
  `qty` int(11) NOT NULL,
  `price` decimal(7,2) DEFAULT NULL,
  `list_id` int(11) DEFAULT NULL,
  `supplier_id` int(11) DEFAULT NULL,
  `sub_supplier_id` int(11) DEFAULT NULL,
  `cost_price` varchar(20) DEFAULT NULL,
  `none_customer_invoice_item` int(11) DEFAULT NULL,
  `item_purchase_type` enum('workorder','stock','cls','projectpo') DEFAULT NULL,
  `item_purchase_type_number` varchar(50) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `po_preorder_parts`
--

/*!40000 ALTER TABLE `po_preorder_parts` DISABLE KEYS */;
INSERT INTO `po_preorder_parts` VALUES (1,1,'CLS-1001',1,15.80,1,1,1,'0.00',1,'cls',NULL),(2,2,'CLS-1002',2,23.05,2,2,2,'',2,'projectpo','1002'),(3,3,'CLS-1003',3,30.30,1,3,3,'$95.00',3,'stock','1003');
/*!40000 ALTER TABLE `po_preorder_parts` ENABLE KEYS */;


--
-- Table structure for table `po_preorder_soparts`
--

DROP TABLE IF EXISTS `po_preorder_soparts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `po_preorder_soparts` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `pre_poid` int(11) NOT NULL,
  `name` text NOT NULL,
  `qty` int(11) NOT NULL,
  `price` decimal(7,2) DEFAULT NULL,
  `list_id` int(11) DEFAULT NULL,
  `supplier_id` int(11) DEFAULT NULL,
  `sub_supplier_id` int(11) DEFAULT NULL,
  `cost_price` varchar(20) DEFAULT NULL,
  `none_customer_invoice_item` int(11) DEFAULT NULL,
  `item_purchase_type` enum('workorder','stock','cls','projectpo') DEFAULT NULL,
  `item_purchase_type_number` varchar(50) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `po_preorder_soparts`
--

/*!40000 ALTER TABLE `po_preorder_soparts` DISABLE KEYS */;
INSERT INTO `po_preorder_soparts` VALUES (1,1,'Derek Chan',1,15.80,1,1,1,'410.00',1,NULL,'1001'),(2,2,'Derek Chan',2,23.05,2,2,2,'410.00',2,'stock','1002');
/*!40000 ALTER TABLE `po_preorder_soparts` ENABLE KEYS */;


--
-- Table structure for table `po_invoice`
--

DROP TABLE IF EXISTS `po_invoice`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `po_invoice` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `poid` int(11) NOT NULL,
  `invoicenumber` varchar(100) DEFAULT NULL,
  `invoice_supplier_id` int(11) DEFAULT NULL,
  `tax_amount` decimal(7,2) NOT NULL,
  `tax_code` varchar(25) NOT NULL,
  `workordernumber` varchar(100) DEFAULT NULL,
  `shipping_charges` varchar(50) DEFAULT NULL,
  `cls_invoicenumber` varchar(50) DEFAULT NULL,
  `invoice_report` text DEFAULT NULL,
  `tax_hst` decimal(7,2) DEFAULT NULL,
  `tax_gst` decimal(7,2) DEFAULT NULL,
  `tax_pst` decimal(7,2) DEFAULT NULL,
  `tax_tvp` decimal(7,2) DEFAULT NULL,
  `sub_total` varchar(25) DEFAULT NULL,
  `total_amount` varchar(25) DEFAULT NULL,
  `createdby` int(11) DEFAULT NULL,
  `date_created` date DEFAULT NULL,
  `invoice_date` date DEFAULT NULL,
  `invoice_level` int(11) DEFAULT NULL,
  `sage_done` int(11) DEFAULT NULL,
  `stock_updated_during_mark_invoice` int(11) DEFAULT NULL,
  `is_invoiced` int(11) DEFAULT NULL,
  `rgaid` int(11) DEFAULT NULL,
  `forced_markinvoice_button` int(11) DEFAULT NULL,
  `appliedtaxrate` varchar(15) DEFAULT NULL,
  `appliedtaxrate_pst` varchar(12) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `po_invoice`
--

/*!40000 ALTER TABLE `po_invoice` DISABLE KEYS */;
INSERT INTO `po_invoice` VALUES (1,1,'INV-1001',1,13.00,'HST',1001,'1,234.50','CLS-4100','Replaced driver and verified output on all four fixtures.',15.72,14.89,15.32,15.69,'100.00','113.00',1,'2025-02-03','2025-02-03',1,1,1,1,1,1,'13.000','0.000'),(2,2,'INV-1002',2,0.00,'HST',1002,'','CLS-4101','Commande reçue partielle, reste 2 unités en reliquat.',22.97,22.14,22.57,22.94,'','',2,'2025-02-10','2025-02-10',2,2,2,2,2,2,'13.000',NULL),(3,3,'INV-1003',NULL,160.49,'HST',1003,NULL,'CLS-4102','Commande reçue partielle, reste 2 unités en reliquat.',30.22,29.39,29.82,30.19,'1,234.50','$1,234.50',3,'2025-02-14','0000-00-00',3,3,3,3,3,3,'13.000','0.000'),(4,4,'INV-1004',4,0.00,'HST',1004,'0.00','CLS-4103','Vérifier le câblage et la boîte de jonction avant la prochaine visite.',37.47,36.64,37.07,37.44,NULL,'n/a',4,'2025-02-20',NULL,4,4,4,4,4,4,'13.000','0.000');
/*!40000 ALTER TABLE `po_invoice` ENABLE KEYS */;


--
-- Table structure for table `po_invoice_parts`
--

DROP TABLE IF EXISTS `po_invoice_parts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `po_invoice_parts` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `poid` int(11) DEFAULT NULL,
  `invoice_id` int(11) NOT NULL,
  `partno` varchar(20) NOT NULL,
  `model_number` varchar(200) DEFAULT NULL,
  `actual_qty` decimal(7,2) DEFAULT NULL,
  `backorder_qty` decimal(7,2) DEFAULT NULL,
  `qty` decimal(7,2) DEFAULT NULL,
  `price` varchar(20) DEFAULT NULL,
  `linetotal` varchar(20) DEFAULT NULL,
  `sortorder` int(11) DEFAULT NULL,
  `sageprojectno` varchar(50) DEFAULT NULL,
  `invoice_project` varchar(60) DEFAULT NULL,
  `update_stock_quantity` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `po_invoice_parts`
--

/*!40000 ALTER TABLE `po_invoice_parts` DISABLE KEYS */;
INSERT INTO `po_invoice_parts` VALUES (1,1,1,'CLS-1001','MOD-2095',2.00,1.00,2.00,'45.00','90.00',1,NULL,'1001',NULL),(2,2,2,'CLS-1002','MOD-2095',1.00,2.00,1.00,'','',2,'1002','1002',2),(3,3,3,'---','MOD-6622',0.00,10.00,10.00,'n/a','n/a',3,'1003','',3),(4,4,4,'CLS-1004','MOD-6622',2.00,4.00,2.00,'$1,234.50','$2,469.00',4,'1004','1004',4);
/*!40000 ALTER TABLE `po_invoice_parts` ENABLE KEYS */;


--
-- Table structure for table `po_quote`
--

DROP TABLE IF EXISTS `po_quote`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `po_quote` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `poid` int(11) DEFAULT NULL,
  `report` text DEFAULT NULL,
  `status` int(11) DEFAULT NULL,
  `priority` int(11) DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `date_received` date DEFAULT NULL,
  `date_created` date DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `po_quote`
--

/*!40000 ALTER TABLE `po_quote` DISABLE KEYS */;
INSERT INTO `po_quote` VALUES (1,1,'Emergency circuit tested and tagged; report signed by site contact.',1,1,'Luminaire extérieur remplacé, façade ô côté cour.','2025-03-01','2025-03-01'),(2,2,'Replaced driver and verified output on all four fixtures.',2,2,'Customer approved the repair by email; completion photo attached.','2025-03-02','2025-03-02');
/*!40000 ALTER TABLE `po_quote` ENABLE KEYS */;


--
-- Table structure for table `po_quote_requested_parts`
--

DROP TABLE IF EXISTS `po_quote_requested_parts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `po_quote_requested_parts` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `req_qoid` int(11) NOT NULL,
  `partno` varchar(20) NOT NULL,
  `qty` int(11) NOT NULL,
  `price` decimal(7,2) DEFAULT NULL,
  `supplier_lists` text DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `po_quote_requested_parts`
--

/*!40000 ALTER TABLE `po_quote_requested_parts` DISABLE KEYS */;
INSERT INTO `po_quote_requested_parts` VALUES (1,1,'CLS-1001',1,15.80,'Emergency circuit tested and tagged; report signed by site contact.'),(2,2,'CLS-1002',2,23.05,NULL),(3,1,'CLS-1003',3,30.30,'Replaced driver and verified output on all four fixtures.');
/*!40000 ALTER TABLE `po_quote_requested_parts` ENABLE KEYS */;


--
-- Table structure for table `rejected_invoices`
--

DROP TABLE IF EXISTS `rejected_invoices`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `rejected_invoices` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `woid` int(11) NOT NULL,
  `invoice_no` varchar(100) NOT NULL,
  `date_rejected` int(11) NOT NULL,
  `rejected_reason` text DEFAULT NULL,
  `invoice_content` longtext DEFAULT NULL,
  `rejected_by_detail` varchar(200) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `rejected_invoices`
--

/*!40000 ALTER TABLE `rejected_invoices` DISABLE KEYS */;
INSERT INTO `rejected_invoices` VALUES (1,1001,'INV-4100',1,'Emergency circuit tested and tagged; report signed by site contact.','Luminaire extérieur remplacé, façade ô côté cour.','Pending'),(2,1002,'INV-4101',2,'Vérifier le câblage et la boîte de jonction avant la prochaine visite.','Commande reçue partielle, reste 2 unités en reliquat.','CLS');
/*!40000 ALTER TABLE `rejected_invoices` ENABLE KEYS */;


--
-- Table structure for table `po_quote_request_status`
--

DROP TABLE IF EXISTS `po_quote_request_status`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `po_quote_request_status` (
  `id` tinyint(1) NOT NULL AUTO_INCREMENT,
  `name` varchar(25) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `po_quote_request_status`
--

/*!40000 ALTER TABLE `po_quote_request_status` DISABLE KEYS */;
/*!40000 ALTER TABLE `po_quote_request_status` ENABLE KEYS */;


--
-- Table structure for table `po_quote_submitted_status`
--

DROP TABLE IF EXISTS `po_quote_submitted_status`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `po_quote_submitted_status` (
  `id` tinyint(1) NOT NULL AUTO_INCREMENT,
  `name` varchar(25) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `po_quote_submitted_status`
--

/*!40000 ALTER TABLE `po_quote_submitted_status` DISABLE KEYS */;
/*!40000 ALTER TABLE `po_quote_submitted_status` ENABLE KEYS */;


--
-- Table structure for table `po_quote_suppliers`
--

DROP TABLE IF EXISTS `po_quote_suppliers`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `po_quote_suppliers` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `req_qoid` int(11) DEFAULT NULL,
  `supplier_id` int(11) DEFAULT NULL,
  `list_id` int(11) DEFAULT NULL,
  `sage_id` int(11) DEFAULT NULL,
  `supplier_user_id` int(11) DEFAULT NULL,
  `supplier_response_status` enum('waiting','accepted','decline') DEFAULT NULL,
  `quotes_counter` int(11) DEFAULT NULL,
  `resubmission_request` int(11) DEFAULT NULL,
  `dated` datetime DEFAULT NULL,
  `msg_notes` longtext DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `po_quote_suppliers`
--

/*!40000 ALTER TABLE `po_quote_suppliers` DISABLE KEYS */;
/*!40000 ALTER TABLE `po_quote_suppliers` ENABLE KEYS */;


--
-- Table structure for table `po_quote_requested_parts_detail`
--

DROP TABLE IF EXISTS `po_quote_requested_parts_detail`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `po_quote_requested_parts_detail` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `req_qoid` int(11) NOT NULL,
  `partno` varchar(20) NOT NULL,
  `qty` int(11) NOT NULL,
  `price` decimal(7,2) DEFAULT NULL,
  `list_id` int(11) DEFAULT NULL,
  `supplier_id` int(11) DEFAULT NULL,
  `cost_price` varchar(20) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `po_quote_requested_parts_detail`
--

/*!40000 ALTER TABLE `po_quote_requested_parts_detail` DISABLE KEYS */;
/*!40000 ALTER TABLE `po_quote_requested_parts_detail` ENABLE KEYS */;


--
-- Table structure for table `po_supplier_quote`
--

DROP TABLE IF EXISTS `po_supplier_quote`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `po_supplier_quote` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `req_qoid` int(11) DEFAULT NULL,
  `poid` int(11) DEFAULT NULL,
  `supplier_id` int(11) DEFAULT NULL,
  `report` text DEFAULT NULL,
  `status` int(11) DEFAULT NULL,
  `priority` int(11) DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `exp_delivery_date` date DEFAULT NULL,
  `date_created` date DEFAULT NULL,
  `resubmission_request` int(11) DEFAULT NULL,
  `processed_as_order` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `po_supplier_quote`
--

/*!40000 ALTER TABLE `po_supplier_quote` DISABLE KEYS */;
/*!40000 ALTER TABLE `po_supplier_quote` ENABLE KEYS */;


--
-- Table structure for table `po_supplier_quote_parts`
--

DROP TABLE IF EXISTS `po_supplier_quote_parts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `po_supplier_quote_parts` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `sup_qoid` int(11) DEFAULT NULL,
  `req_qoid` int(11) NOT NULL,
  `partno` varchar(20) NOT NULL,
  `qty` int(11) NOT NULL,
  `price` decimal(7,2) DEFAULT NULL,
  `additional_note` text DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `po_supplier_quote_parts`
--

/*!40000 ALTER TABLE `po_supplier_quote_parts` DISABLE KEYS */;
/*!40000 ALTER TABLE `po_supplier_quote_parts` ENABLE KEYS */;


--
-- Table structure for table `po_invoice_soparts`
--

DROP TABLE IF EXISTS `po_invoice_soparts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `po_invoice_soparts` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `poid` int(11) DEFAULT NULL,
  `invoice_id` int(11) NOT NULL,
  `name` text NOT NULL,
  `po_so_part_id` int(11) NOT NULL,
  `actual_qty` decimal(7,2) DEFAULT NULL,
  `backorder_qty` decimal(7,2) DEFAULT NULL,
  `qty` decimal(7,2) DEFAULT NULL,
  `price` varchar(20) DEFAULT NULL,
  `linetotal` varchar(20) DEFAULT NULL,
  `sortorder` int(11) DEFAULT NULL,
  `sageprojectno` varchar(50) DEFAULT NULL,
  `invoice_project` varchar(60) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `po_invoice_soparts`
--

/*!40000 ALTER TABLE `po_invoice_soparts` DISABLE KEYS */;
/*!40000 ALTER TABLE `po_invoice_soparts` ENABLE KEYS */;


--
-- Table structure for table `po_preorder_suppliers`
--

DROP TABLE IF EXISTS `po_preorder_suppliers`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `po_preorder_suppliers` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `pre_poid` int(11) DEFAULT NULL,
  `supplier_id` int(11) DEFAULT NULL,
  `sub_supplier_id` int(11) DEFAULT NULL,
  `list_id` int(11) DEFAULT NULL,
  `supplier_response_status` enum('waiting','accepted','decline') DEFAULT NULL,
  `quotes_counter` int(11) DEFAULT NULL,
  `resubmission_request` int(11) DEFAULT NULL,
  `dated` datetime DEFAULT NULL,
  `msg_notes` longtext DEFAULT NULL,
  `processed_as_order` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `po_preorder_suppliers`
--

/*!40000 ALTER TABLE `po_preorder_suppliers` DISABLE KEYS */;
/*!40000 ALTER TABLE `po_preorder_suppliers` ENABLE KEYS */;


--
-- Table structure for table `po_submission_after_approval`
--

DROP TABLE IF EXISTS `po_submission_after_approval`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `po_submission_after_approval` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `poid` int(11) DEFAULT NULL,
  `email_subject` text DEFAULT NULL,
  `email_notes` text DEFAULT NULL,
  `main_email` text DEFAULT NULL,
  `allianceemails` text DEFAULT NULL,
  `cc_emails` text DEFAULT NULL,
  `attach_po_file` varchar(10) DEFAULT NULL,
  `attach_all_files` varchar(10) DEFAULT NULL,
  `attach_individual_files` text DEFAULT NULL,
  `submit_by` int(11) DEFAULT NULL,
  `is_pending` int(11) DEFAULT NULL,
  `date_created` datetime DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `po_submission_after_approval`
--

/*!40000 ALTER TABLE `po_submission_after_approval` DISABLE KEYS */;
/*!40000 ALTER TABLE `po_submission_after_approval` ENABLE KEYS */;


--
-- Table structure for table `parts_inventory`
--

DROP TABLE IF EXISTS `parts_inventory`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `parts_inventory` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `part_id` int(11) NOT NULL,
  `supplier_id` int(11) NOT NULL,
  `shipment_detail` text DEFAULT NULL,
  `purchased_quantity` int(11) DEFAULT NULL,
  `cost_price` decimal(7,2) DEFAULT NULL,
  `sell_price` decimal(7,2) DEFAULT NULL,
  `markup` decimal(7,2) DEFAULT NULL,
  `sold_quantity` int(11) DEFAULT NULL,
  `status` varchar(15) DEFAULT NULL,
  `date_purchased` datetime DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `parts_inventory`
--

/*!40000 ALTER TABLE `parts_inventory` DISABLE KEYS */;
INSERT INTO `parts_inventory` VALUES (1,1,1,'Customer approved the repair by email; completion photo attached.',1,12.60,16.49,12.95,1,'received','2025-03-01 09:30:00'),(2,2,2,NULL,2,19.85,23.74,20.20,NULL,'sold','2025-03-02 09:30:00'),(3,3,3,'Emergency circuit tested and tagged; report signed by site contact.',3,27.10,30.99,27.45,3,'adjustment','2025-03-03 09:30:00'),(4,4,4,NULL,4,34.35,NULL,34.70,4,NULL,'2025-03-04 09:30:00');
/*!40000 ALTER TABLE `parts_inventory` ENABLE KEYS */;


--
-- Table structure for table `parts_inventory_adjustment`
--

DROP TABLE IF EXISTS `parts_inventory_adjustment`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `parts_inventory_adjustment` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `partno` varchar(50) DEFAULT NULL,
  `qty` varchar(15) DEFAULT NULL,
  `price` varchar(30) DEFAULT NULL,
  `date_created` timestamp DEFAULT NULL,
  `adjustment_type` enum('global','alliance','subcontractor','customer','contractor','') DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `is_log_deleted` int(11) DEFAULT NULL,
  `inserted_datetime` timestamp DEFAULT NULL,
  `workordernumber` varchar(25) DEFAULT NULL,
  `site` int(11) DEFAULT NULL,
  `subcontractor` int(11) DEFAULT NULL,
  `mass_adjustment_number` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `parts_inventory_adjustment`
--

/*!40000 ALTER TABLE `parts_inventory_adjustment` DISABLE KEYS */;
INSERT INTO `parts_inventory_adjustment` VALUES (1,'CLS-1001','1','$95.00','2025-03-01 09:30:00','global','Emergency circuit tested and tagged; report signed by site contact.',1,'2025-03-01 09:30:00',1001,1,1,1),(2,'CLS-1002','2','410.00','2025-03-02 09:30:00','customer','Customer approved the repair by email; completion photo attached.',2,'2025-03-02 09:30:00',1002,2,2,2),(3,'CLS-1003','3','12.50','2025-03-03 09:30:00','alliance',NULL,3,'2025-03-03 09:30:00',1003,3,3,3),(4,'CLS-1004','4','$95.00',NULL,'customer','Emergency circuit tested and tagged; report signed by site contact.',NULL,'2025-03-04 09:30:00',1004,4,4,4);
/*!40000 ALTER TABLE `parts_inventory_adjustment` ENABLE KEYS */;


--
-- Table structure for table `parts_purchased_inventory`
--

DROP TABLE IF EXISTS `parts_purchased_inventory`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `parts_purchased_inventory` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `part_no` varchar(50) DEFAULT NULL,
  `part_desc` varchar(200) DEFAULT NULL,
  `inventory_tracking_id` int(11) DEFAULT NULL,
  `invoice_number` varchar(50) DEFAULT NULL,
  `invoice_line_no` int(11) DEFAULT NULL,
  `unit_price` decimal(7,2) DEFAULT NULL,
  `qty` int(11) DEFAULT NULL,
  `sage_vendor_id` int(11) DEFAULT NULL,
  `date_invoiced` datetime DEFAULT NULL,
  `date_created_time` bigint(20) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `parts_purchased_inventory`
--

/*!40000 ALTER TABLE `parts_purchased_inventory` DISABLE KEYS */;
INSERT INTO `parts_purchased_inventory` VALUES (1,'CLS-1001','',1,'INV-4100',1,NULL,1,1,'2025-03-01 09:30:00',1),(2,'CLS-1002','Scheduled',2,'INV-4101',2,22.36,2,2,'2025-03-02 09:30:00',2),(3,'CLS-1003','Standard',3,'INV-4102',3,29.61,3,3,'2025-03-03 09:30:00',3);
/*!40000 ALTER TABLE `parts_purchased_inventory` ENABLE KEYS */;


--
-- Table structure for table `parts_purchasing_log`
--

DROP TABLE IF EXISTS `parts_purchasing_log`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `parts_purchasing_log` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `poid` int(11) DEFAULT NULL,
  `partno` varchar(50) DEFAULT NULL,
  `qty` varchar(15) DEFAULT NULL,
  `price` varchar(15) DEFAULT NULL,
  `stock_identifier` varchar(50) DEFAULT NULL,
  `date_created` timestamp DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `parts_purchasing_log`
--

/*!40000 ALTER TABLE `parts_purchasing_log` DISABLE KEYS */;
INSERT INTO `parts_purchasing_log` VALUES (1,1,'CLS-1001','1','$95.00','STK-1000','2025-03-01 09:30:00'),(2,2,'CLS-1002','2','1,234.50','STK-1001','2025-03-02 09:30:00'),(3,NULL,'CLS-1003','3','1,234.50','STK-1002','2025-03-03 09:30:00');
/*!40000 ALTER TABLE `parts_purchasing_log` ENABLE KEYS */;


--
-- Table structure for table `parts_salepurchase_log`
--

DROP TABLE IF EXISTS `parts_salepurchase_log`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `parts_salepurchase_log` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `woid_poid` int(11) DEFAULT NULL,
  `invoice_id` int(11) DEFAULT NULL,
  `invoice_number` varchar(50) DEFAULT NULL,
  `partno` varchar(50) DEFAULT NULL,
  `qty` varchar(15) DEFAULT NULL,
  `price` varchar(15) DEFAULT NULL,
  `date_created` timestamp DEFAULT NULL,
  `transaction_type` varchar(15) DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `is_log_deleted` int(11) DEFAULT NULL,
  `inserted_datetime` timestamp DEFAULT NULL,
  `is_includeed_in_stock_management` int(11) DEFAULT NULL,
  `adjustment_type` enum('alliance','subcontractor','customer','contractor','') DEFAULT NULL,
  `on_field_counted_qty` varchar(20) DEFAULT NULL,
  `adj_subcontractor` int(11) DEFAULT NULL,
  `adj_site` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `parts_salepurchase_log`
--

/*!40000 ALTER TABLE `parts_salepurchase_log` DISABLE KEYS */;
INSERT INTO `parts_salepurchase_log` VALUES (1,1001,1,'INV-4100','CLS-1001','1','0.00','2025-03-01 09:30:00','','Replaced driver and verified output on all four fixtures.',1,'2025-03-01 09:30:00',1,'subcontractor','1',1,1),(2,1002,NULL,'INV-4101','','2','410.00','2025-03-02 09:30:00','sale','Replaced driver and verified output on all four fixtures.',2,'2025-03-02 09:30:00',2,'contractor','2',2,2),(3,1003,3,'INV-4102','CLS-1003','3','0.00','2025-03-03 09:30:00','adjustment','Vérifier le câblage et la boîte de jonction avant la prochaine visite.',3,'2025-03-03 09:30:00',3,'customer','3',3,3);
/*!40000 ALTER TABLE `parts_salepurchase_log` ENABLE KEYS */;


--
-- Table structure for table `parts_selling_log`
--

DROP TABLE IF EXISTS `parts_selling_log`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `parts_selling_log` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `woid` int(11) DEFAULT NULL,
  `partno` varchar(50) DEFAULT NULL,
  `qty` varchar(15) DEFAULT NULL,
  `price` varchar(15) DEFAULT NULL,
  `date_created` timestamp DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `parts_selling_log`
--

/*!40000 ALTER TABLE `parts_selling_log` DISABLE KEYS */;
INSERT INTO `parts_selling_log` VALUES (1,1001,'CLS-1001','1','0.00','2025-03-01 09:30:00'),(2,1002,'CLS-1002','2',NULL,'2025-03-02 09:30:00'),(3,1003,'CLS-1003','3','0.00','2025-03-03 09:30:00');
/*!40000 ALTER TABLE `parts_selling_log` ENABLE KEYS */;


--
-- Table structure for table `parts_price_lock`
--

DROP TABLE IF EXISTS `parts_price_lock`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `parts_price_lock` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `is_locked` int(11) DEFAULT NULL,
  `locked_by` varchar(50) DEFAULT NULL,
  `lock_time` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `parts_price_lock`
--

/*!40000 ALTER TABLE `parts_price_lock` DISABLE KEYS */;
INSERT INTO `parts_price_lock` VALUES (1,1,'Derek Chan',1),(2,2,'Derek Chan',2);
/*!40000 ALTER TABLE `parts_price_lock` ENABLE KEYS */;


--
-- Table structure for table `inv_project`
--

DROP TABLE IF EXISTS `inv_project`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `inv_project` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `woid` int(11) NOT NULL,
  `sage_project_workorder` varchar(100) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `inv_project`
--

/*!40000 ALTER TABLE `inv_project` DISABLE KEYS */;
INSERT INTO `inv_project` VALUES (1,1001,'1001'),(2,1002,'1003'),(3,0,NULL),(4,88888882,'88888882'),(5,1005,'');
/*!40000 ALTER TABLE `inv_project` ENABLE KEYS */;


--
-- Table structure for table `inv_hours`
--

DROP TABLE IF EXISTS `inv_hours`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `inv_hours` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `woid` int(11) NOT NULL,
  `rate` decimal(7,2) DEFAULT NULL,
  `entered_rate` varchar(12) DEFAULT NULL,
  `date` date NOT NULL,
  `hours` decimal(7,2) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `inv_hours`
--

/*!40000 ALTER TABLE `inv_hours` DISABLE KEYS */;
INSERT INTO `inv_hours` VALUES (1,1001,12.89,'1,234.50','2025-03-12',3.50),(2,1002,NULL,'0.00','2025-03-13',2.00),(3,1003,27.39,'12.50','2025-03-14',1.25),(4,1006,34.64,'$95.00','0000-00-00',4.00);
/*!40000 ALTER TABLE `inv_hours` ENABLE KEYS */;


--
-- Table structure for table `inv_parts`
--

DROP TABLE IF EXISTS `inv_parts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `inv_parts` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `woid` int(11) NOT NULL,
  `partno` varchar(20) NOT NULL,
  `qty` decimal(7,2) NOT NULL,
  `price` decimal(11,2) NOT NULL,
  `entered_price` varchar(12) DEFAULT NULL,
  `linked_sopart_cost_price` varchar(30) DEFAULT NULL,
  `linked_part_sopart` varchar(20) DEFAULT NULL,
  `is_local_part` int(11) DEFAULT NULL,
  `applied_woid` varchar(20) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `inv_parts`
--

/*!40000 ALTER TABLE `inv_parts` DISABLE KEYS */;
INSERT INTO `inv_parts` VALUES (1,1001,'CLS-1001',2.00,45.00,'$45.00','45.00','Emergency light head',1,1001),(2,1002,'CLS-1002',1.00,120.50,'120.50',NULL,'Emergency light head',2,1002),(3,1003,'CLS-1003',4.00,12.75,'410.00','0.00',NULL,0,1003),(4,88888881,'CLS-1004',1.00,9.99,'410.00','12.50','Emergency light head',4,1004),(5,1005,'CLS-1009',2.00,33.10,'1,234.50',NULL,'Emergency light head',1,'99999999');
/*!40000 ALTER TABLE `inv_parts` ENABLE KEYS */;


--
-- Table structure for table `inv_soparts`
--

DROP TABLE IF EXISTS `inv_soparts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `inv_soparts` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `woid` int(11) NOT NULL,
  `name` text NOT NULL,
  `qty` decimal(7,2) NOT NULL,
  `price` decimal(11,2) NOT NULL,
  `entered_price` varchar(12) DEFAULT NULL,
  `is_local_part` int(11) DEFAULT NULL,
  `is_emergency_lighting` int(11) DEFAULT NULL,
  `is_service_report` int(11) DEFAULT NULL,
  `warranty_years` varchar(25) DEFAULT NULL,
  `labor_warranty_years` varchar(25) DEFAULT NULL,
  `applied_woid` varchar(25) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `inv_soparts`
--

/*!40000 ALTER TABLE `inv_soparts` DISABLE KEYS */;
INSERT INTO `inv_soparts` VALUES (1,1001,'Emergency light head',2.00,85.00,'$85.00',1,1,1,'1','1',1001),(2,1002,'Labour - after hours',1.00,190.00,'410.00',2,2,2,'1','1','1002'),(3,1005,'Luminaire extérieur DEL',1.00,410.00,'410.00',3,3,3,'1','1','1005');
/*!40000 ALTER TABLE `inv_soparts` ENABLE KEYS */;


--
-- Table structure for table `inv_tax`
--

DROP TABLE IF EXISTS `inv_tax`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `inv_tax` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `woid` int(11) NOT NULL,
  `name` varchar(100) NOT NULL,
  `appliedtaxrate` varchar(15) DEFAULT NULL,
  `calc_type` enum('sub','sub_project','local','local_project','') DEFAULT NULL,
  `tax_amount` varchar(30) DEFAULT NULL,
  `subtotal_amount` varchar(30) DEFAULT NULL,
  `total_amount` varchar(30) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `inv_tax`
--

/*!40000 ALTER TABLE `inv_tax` DISABLE KEYS */;
INSERT INTO `inv_tax` VALUES (1,1001,'HST','13.000','sub','','','113.00'),(2,1002,'HST','13.000','sub_project','$13.00','$100.00','$113.00'),(3,1003,'GST','13.000','local','n/a',NULL,NULL),(4,1004,'HST','13.000','local_project','0.00','0.00','0.00'),(5,88888881,'PST','13.000','sub','5.50','55.00','60.50'),(6,0,'HST','13.000','sub','13.00','100.00','113.00');
/*!40000 ALTER TABLE `inv_tax` ENABLE KEYS */;


--
-- Table structure for table `rga`
--

DROP TABLE IF EXISTS `rga`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `rga` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `supplier_id` int(11) DEFAULT NULL,
  `poid` int(11) DEFAULT NULL,
  `status` int(11) DEFAULT NULL,
  `status_on_july_21_2025` int(11) DEFAULT NULL,
  `rga_notes` text DEFAULT NULL,
  `notes` longtext DEFAULT NULL,
  `request_date` date DEFAULT NULL,
  `rga_invoicedate` varchar(50) DEFAULT NULL,
  `rga_invoicenumber` varchar(50) DEFAULT NULL,
  `ship_address_contactname` text DEFAULT NULL,
  `ship_address_company` text DEFAULT NULL,
  `ship_address_street1` text DEFAULT NULL,
  `ship_address_street2` text DEFAULT NULL,
  `ship_address_city` text DEFAULT NULL,
  `ship_address_province` text DEFAULT NULL,
  `ship_address_postalcode` text DEFAULT NULL,
  `ship_address_phone` text DEFAULT NULL,
  `shipping_address` text DEFAULT NULL,
  `createdby` int(11) DEFAULT NULL,
  `is_marked_critical` int(11) DEFAULT NULL,
  `completiondate` int(11) DEFAULT NULL,
  `date_created` datetime DEFAULT NULL,
  `date_completed` datetime DEFAULT NULL,
  `rga_folder_attach_path` varchar(200) DEFAULT NULL,
  `is_online_vendor_order` int(11) DEFAULT NULL,
  `stock_updated` int(11) DEFAULT NULL,
  `revision_no` int(11) DEFAULT NULL,
  `is_type_maintenance` int(11) DEFAULT NULL,
  `is_submitted` int(11) DEFAULT NULL,
  `rga_type` varchar(20) DEFAULT NULL,
  `replacement_type` varchar(25) DEFAULT NULL,
  `subcontractor` int(11) DEFAULT NULL,
  `site` int(11) DEFAULT NULL,
  `workordernumber` varchar(20) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `rga`
--

/*!40000 ALTER TABLE `rga` DISABLE KEYS */;
INSERT INTO `rga` VALUES (1,1,1,1,1,'Defective ballast returned for credit.','Replaced driver and verified output on all four fixtures.','2025-03-20','2025-03-01','RGA-3000','Vérifier le câblage et la boîte de jonction avant la prochaine visite.','Commande reçue partielle, reste 2 unités en reliquat.','Commande reçue partielle, reste 2 unités en reliquat.','Luminaire extérieur remplacé, façade ô côté cour.','Luminaire extérieur remplacé, façade ô côté cour.','Luminaire extérieur remplacé, façade ô côté cour.','Luminaire extérieur remplacé, façade ô côté cour.','613-555-0177','Customer approved the repair by email; completion photo attached.',1,1,1,'2025-03-20 10:00:00','2025-03-01 09:30:00',NULL,1,1,1,1,1,'vendor_return',NULL,1,1,'1001'),(2,2,2,2,2,NULL,'','2025-03-22','2025-03-02','RGA-3001','Customer approved the repair by email; completion photo attached.','Luminaire extérieur remplacé, façade ô côté cour.','Customer approved the repair by email; completion photo attached.','Vérifier le câblage et la boîte de jonction avant la prochaine visite.','Commande reçue partielle, reste 2 unités en reliquat.','Customer approved the repair by email; completion photo attached.',NULL,'416-555-0110',NULL,3,2,2,'2025-03-22 11:30:00','2025-03-02 09:30:00','Scheduled',2,2,2,2,2,NULL,'replacement',2,2,'1002'),(3,3,3,3,3,'Replaced driver and verified output on all four fixtures.','Luminaire extérieur remplacé, façade ô côté cour.','2025-03-25','2025-03-03','RGA-3002','Customer approved the repair by email; completion photo attached.','Vérifier le câblage et la boîte de jonction avant la prochaine visite.','Emergency circuit tested and tagged; report signed by site contact.','Commande reçue partielle, reste 2 unités en reliquat.','Luminaire extérieur remplacé, façade ô côté cour.','Replaced driver and verified output on all four fixtures.','Emergency circuit tested and tagged; report signed by site contact.',NULL,'Emergency circuit tested and tagged; report signed by site contact.',2,3,3,'2025-03-25 09:15:00','2025-03-03 09:30:00',NULL,3,3,3,3,3,'vendor_return',NULL,3,3,'1003'),(4,4,4,4,4,NULL,'',NULL,'2025-03-04','','Commande reçue partielle, reste 2 unités en reliquat.','Customer approved the repair by email; completion photo attached.','Vérifier le câblage et la boîte de jonction avant la prochaine visite.','Replaced driver and verified output on all four fixtures.',NULL,'Replaced driver and verified output on all four fixtures.','Vérifier le câblage et la boîte de jonction avant la prochaine visite.','905-555-0142','Vérifier le câblage et la boîte de jonction avant la prochaine visite.',4,4,4,'2025-03-28 14:45:00','2025-03-04 09:30:00','Alliance',4,4,NULL,4,4,'warranty','replacement',4,4,'1004');
/*!40000 ALTER TABLE `rga` ENABLE KEYS */;


--
-- Table structure for table `rga_parts`
--

DROP TABLE IF EXISTS `rga_parts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `rga_parts` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `rgaid` int(11) NOT NULL,
  `partno` varchar(50) NOT NULL,
  `qty` decimal(7,2) DEFAULT NULL,
  `price` varchar(20) DEFAULT NULL,
  `model_number` varchar(150) DEFAULT NULL,
  `reason_for_return` text DEFAULT NULL,
  `item_purchase_type` varchar(50) DEFAULT NULL,
  `item_purchase_type_number` varchar(50) DEFAULT NULL,
  `po_number` varchar(50) DEFAULT NULL,
  `po_part_id` int(11) DEFAULT NULL,
  `return_qty` varchar(15) DEFAULT NULL,
  `under_warranty` int(11) DEFAULT NULL,
  `rp_invoicenumber` varchar(100) DEFAULT NULL,
  `rp_invoicedate` varchar(25) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `rga_parts`
--

/*!40000 ALTER TABLE `rga_parts` DISABLE KEYS */;
INSERT INTO `rga_parts` VALUES (1,1,'CLS-1001',1.00,'0.00','MOD-7781','Emergency circuit tested and tagged; report signed by site contact.','workorder','1001','INV-4100',1,'1',1,'Standard','2025-03-01'),(2,2,'CLS-1002',2.00,'$95.00','MOD-4410',NULL,'stock','1002','INV-4101',2,NULL,2,'Maintenance','2025-03-02'),(3,3,'CLS-1003',3.00,'410.00','MOD-2095','Vérifier le câblage et la boîte de jonction avant la prochaine visite.','cls','1003','INV-4102',3,'3',3,'North','2025-03-03'),(4,4,'CLS-1004',4.00,'$95.00','MOD-4410','Commande reçue partielle, reste 2 unités en reliquat.',NULL,'1004','INV-4103',1,'4',4,'Completed','2025-03-04');
/*!40000 ALTER TABLE `rga_parts` ENABLE KEYS */;


--
-- Table structure for table `rga_soparts`
--

DROP TABLE IF EXISTS `rga_soparts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `rga_soparts` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `rgaid` int(11) NOT NULL,
  `name` varchar(200) NOT NULL,
  `qty` decimal(7,2) DEFAULT NULL,
  `price` varchar(20) DEFAULT NULL,
  `model_number` varchar(150) DEFAULT NULL,
  `reason_for_return` text DEFAULT NULL,
  `item_purchase_type` varchar(50) DEFAULT NULL,
  `item_purchase_type_number` varchar(50) DEFAULT NULL,
  `po_number` varchar(50) DEFAULT NULL,
  `po_sopart_id` int(11) DEFAULT NULL,
  `return_qty` varchar(15) DEFAULT NULL,
  `rp_invoicenumber` varchar(25) DEFAULT NULL,
  `rp_invoicedate` varchar(25) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `rga_soparts`
--

/*!40000 ALTER TABLE `rga_soparts` DISABLE KEYS */;
INSERT INTO `rga_soparts` VALUES (1,1,'Jocelyn Roy',1.00,'$95.00',NULL,'Replaced driver and verified output on all four fixtures.','workorder','','INV-4100',1,'1','Alliance',NULL),(2,2,'Hélène Girard',2.00,'$95.00','MOD-7781','Emergency circuit tested and tagged; report signed by site contact.','stock','1002','INV-4101',2,'2','Maintenance','2025-03-02');
/*!40000 ALTER TABLE `rga_soparts` ENABLE KEYS */;


--
-- Table structure for table `sc_inv_hours`
--

DROP TABLE IF EXISTS `sc_inv_hours`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `sc_inv_hours` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `woid` int(11) NOT NULL,
  `rate` decimal(7,2) DEFAULT NULL,
  `entered_rate` varchar(12) DEFAULT NULL,
  `date` date NOT NULL,
  `hours` decimal(7,2) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `sc_inv_hours`
--

/*!40000 ALTER TABLE `sc_inv_hours` DISABLE KEYS */;
/*!40000 ALTER TABLE `sc_inv_hours` ENABLE KEYS */;


--
-- Table structure for table `sc_inv_parts`
--

DROP TABLE IF EXISTS `sc_inv_parts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `sc_inv_parts` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `woid` int(11) NOT NULL,
  `partno` varchar(20) NOT NULL,
  `qty` decimal(7,2) NOT NULL,
  `price` decimal(7,2) NOT NULL,
  `entered_price` varchar(12) DEFAULT NULL,
  `linked_sopart_cost_price` varchar(30) DEFAULT NULL,
  `linked_part_sopart` varchar(20) DEFAULT NULL,
  `is_local_part` int(11) DEFAULT NULL,
  `applied_woid` varchar(20) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `sc_inv_parts`
--

/*!40000 ALTER TABLE `sc_inv_parts` DISABLE KEYS */;
/*!40000 ALTER TABLE `sc_inv_parts` ENABLE KEYS */;


--
-- Table structure for table `sc_inv_soparts`
--

DROP TABLE IF EXISTS `sc_inv_soparts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `sc_inv_soparts` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `woid` int(11) NOT NULL,
  `name` text NOT NULL,
  `qty` decimal(7,2) NOT NULL,
  `price` decimal(7,2) NOT NULL,
  `entered_price` varchar(12) DEFAULT NULL,
  `is_local_part` int(11) DEFAULT NULL,
  `is_emergency_lighting` int(11) DEFAULT NULL,
  `is_service_report` int(11) DEFAULT NULL,
  `warranty_years` varchar(25) DEFAULT NULL,
  `labor_warranty_years` varchar(25) DEFAULT NULL,
  `applied_woid` varchar(25) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `sc_inv_soparts`
--

/*!40000 ALTER TABLE `sc_inv_soparts` DISABLE KEYS */;
/*!40000 ALTER TABLE `sc_inv_soparts` ENABLE KEYS */;


--
-- Table structure for table `sc_inv_tax`
--

DROP TABLE IF EXISTS `sc_inv_tax`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `sc_inv_tax` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `woid` int(11) NOT NULL,
  `name` varchar(100) NOT NULL,
  `appliedtaxrate` varchar(15) DEFAULT NULL,
  `calc_type` enum('sub','sub_project','local','local_project','') DEFAULT NULL,
  `tax_amount` varchar(30) DEFAULT NULL,
  `subtotal_amount` varchar(30) DEFAULT NULL,
  `total_amount` varchar(30) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `sc_inv_tax`
--

/*!40000 ALTER TABLE `sc_inv_tax` DISABLE KEYS */;
/*!40000 ALTER TABLE `sc_inv_tax` ENABLE KEYS */;


--
-- Table structure for table `tjx_quote`
--

DROP TABLE IF EXISTS `tjx_quote`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `tjx_quote` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `status` int(11) DEFAULT NULL,
  `pdf_notes` text DEFAULT NULL,
  `notes` longtext DEFAULT NULL,
  `due_date` varchar(15) DEFAULT NULL,
  `payment_terms` int(11) DEFAULT NULL,
  `ceiling_grid_type` int(11) DEFAULT NULL,
  `ship_address_contactname` text DEFAULT NULL,
  `ship_address_company` text DEFAULT NULL,
  `ship_address_street1` text DEFAULT NULL,
  `ship_address_street2` text DEFAULT NULL,
  `ship_address_city` text DEFAULT NULL,
  `ship_address_province` text DEFAULT NULL,
  `ship_address_postalcode` text DEFAULT NULL,
  `ship_address_phone` text DEFAULT NULL,
  `shipping_address` text DEFAULT NULL,
  `createdby` int(11) DEFAULT NULL,
  `date_created` datetime DEFAULT NULL,
  `tjxquote_folder_attach_path` varchar(200) DEFAULT NULL,
  `revision_no` int(11) DEFAULT NULL,
  `is_submitted` int(11) DEFAULT NULL,
  `ship_to_type` varchar(15) DEFAULT NULL,
  `site` int(11) DEFAULT NULL,
  `workordernumber` varchar(20) DEFAULT NULL,
  `tax_code` varchar(12) DEFAULT NULL,
  `tax_amount` varchar(15) DEFAULT NULL,
  `subtotal_amount` varchar(15) DEFAULT NULL,
  `total_amount` varchar(15) DEFAULT NULL,
  `withoutmarkup_tax_amount` varchar(15) DEFAULT NULL,
  `withoutmarkup_subtotal_amount` varchar(15) DEFAULT NULL,
  `withoutmarkup_total_amount` varchar(15) DEFAULT NULL,
  `revision_notes` text DEFAULT NULL,
  `quote_type` varchar(15) DEFAULT NULL,
  `appliedtaxrate` varchar(12) DEFAULT NULL,
  `is_type_maintenance` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `tjx_quote`
--

/*!40000 ALTER TABLE `tjx_quote` DISABLE KEYS */;
INSERT INTO `tjx_quote` VALUES (1,1,NULL,'Replaced driver and verified output on all four fixtures.','2025-03-01',1,1,'Luminaire extérieur remplacé, façade ô côté cour.','Luminaire extérieur remplacé, façade ô côté cour.','Luminaire extérieur remplacé, façade ô côté cour.','Customer approved the repair by email; completion photo attached.','Vérifier le câblage et la boîte de jonction avant la prochaine visite.','Customer approved the repair by email; completion photo attached.','Replaced driver and verified output on all four fixtures.','613-555-0177','Replaced driver and verified output on all four fixtures.',1,'2025-03-01 09:30:00','Scheduled',1,1,'',1,1001,'HST','0.00','45.00','0.00','45.00','$95.00','12.50','Emergency circuit tested and tagged; report signed by site contact.',NULL,'13.000',1),(2,2,'Customer approved the repair by email; completion photo attached.','Emergency circuit tested and tagged; report signed by site contact.','',2,2,'Emergency circuit tested and tagged; report signed by site contact.','Emergency circuit tested and tagged; report signed by site contact.','Replaced driver and verified output on all four fixtures.','Customer approved the repair by email; completion photo attached.','Emergency circuit tested and tagged; report signed by site contact.','Emergency circuit tested and tagged; report signed by site contact.','Commande reçue partielle, reste 2 unités en reliquat.',NULL,'Commande reçue partielle, reste 2 unités en reliquat.',2,NULL,'Exterior',2,NULL,'site',2,1002,'HST','','12.50','410.00','410.00','12.50','0.00','Replaced driver and verified output on all four fixtures.','tjx','13.000',2),(3,3,'Replaced driver and verified output on all four fixtures.','Commande reçue partielle, reste 2 unités en reliquat.','2025-03-03',3,3,'Emergency circuit tested and tagged; report signed by site contact.','Commande reçue partielle, reste 2 unités en reliquat.','Customer approved the repair by email; completion photo attached.','Luminaire extérieur remplacé, façade ô côté cour.','Commande reçue partielle, reste 2 unités en reliquat.','Customer approved the repair by email; completion photo attached.','Luminaire extérieur remplacé, façade ô côté cour.','905-555-0142','Customer approved the repair by email; completion photo attached.',NULL,'2025-03-03 09:30:00','Completed',NULL,3,'site',3,1003,'HST','$95.00','12.50','0.00','410.00','12.50','$95.00','Luminaire extérieur remplacé, façade ô côté cour.','tjx',NULL,3);
/*!40000 ALTER TABLE `tjx_quote` ENABLE KEYS */;


--
-- Table structure for table `tjx_quote_fixtures`
--

DROP TABLE IF EXISTS `tjx_quote_fixtures`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `tjx_quote_fixtures` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `roomid` int(11) DEFAULT NULL,
  `fixtureid` int(11) DEFAULT NULL,
  `totalfixtures` varchar(12) DEFAULT NULL,
  `quoteid` int(11) DEFAULT NULL,
  `sortorder` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `tjx_quote_fixtures`
--

/*!40000 ALTER TABLE `tjx_quote_fixtures` DISABLE KEYS */;
INSERT INTO `tjx_quote_fixtures` VALUES (1,1,1,'12.50',1,1),(2,2,2,NULL,2,2),(3,3,3,'0.00',3,3);
/*!40000 ALTER TABLE `tjx_quote_fixtures` ENABLE KEYS */;


--
-- Table structure for table `tjx_fixture_parts`
--

DROP TABLE IF EXISTS `tjx_fixture_parts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `tjx_fixture_parts` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `partno` varchar(30) DEFAULT NULL,
  `fixtureid` int(11) DEFAULT NULL,
  `markup` varchar(10) DEFAULT NULL,
  `parttype` enum('ballast','lamp','') DEFAULT NULL,
  `part_ratio_perfixture` varchar(20) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `tjx_fixture_parts`
--

/*!40000 ALTER TABLE `tjx_fixture_parts` DISABLE KEYS */;
INSERT INTO `tjx_fixture_parts` VALUES (1,'CLS-1001',1,'$95.00','lamp','1'),(2,'CLS-1002',2,'$95.00',NULL,'2'),(3,'CLS-1003',3,'410.00','lamp','3');
/*!40000 ALTER TABLE `tjx_fixture_parts` ENABLE KEYS */;


--
-- Table structure for table `tjx_quote_revisions`
--

DROP TABLE IF EXISTS `tjx_quote_revisions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `tjx_quote_revisions` (
  `revision_id` int(11) NOT NULL AUTO_INCREMENT,
  `quoteid` int(11) DEFAULT NULL,
  `created_time` timestamp DEFAULT NULL,
  `revised_by_user` int(11) DEFAULT NULL,
  `revision_type` varchar(45) DEFAULT NULL,
  `data_quote` text DEFAULT NULL,
  `data_fixtures` text DEFAULT NULL,
  `data_parts` longtext DEFAULT NULL,
  `data_soparts` text DEFAULT NULL,
  PRIMARY KEY (`revision_id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `tjx_quote_revisions`
--

/*!40000 ALTER TABLE `tjx_quote_revisions` DISABLE KEYS */;
INSERT INTO `tjx_quote_revisions` VALUES (1,1,'2025-03-01 09:30:00',1,'manual','Customer approved the repair by email; completion photo attached.','','Replaced driver and verified output on all four fixtures.','Customer approved the repair by email; completion photo attached.'),(2,2,'2025-03-02 09:30:00',2,'manual','Luminaire extérieur remplacé, façade ô côté cour.','Luminaire extérieur remplacé, façade ô côté cour.','Luminaire extérieur remplacé, façade ô côté cour.','Customer approved the repair by email; completion photo attached.');
/*!40000 ALTER TABLE `tjx_quote_revisions` ENABLE KEYS */;


--
-- Table structure for table `tjx_sub_invoice`
--

DROP TABLE IF EXISTS `tjx_sub_invoice`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `tjx_sub_invoice` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `quoteid` int(11) DEFAULT NULL,
  `notes` longtext DEFAULT NULL,
  `sub_notes` text DEFAULT NULL,
  `invoice_date` varchar(15) DEFAULT NULL,
  `createdby` int(11) DEFAULT NULL,
  `date_created` datetime DEFAULT NULL,
  `is_submitted` int(11) DEFAULT NULL,
  `invoice_number` varchar(30) DEFAULT NULL,
  `workordernumber` varchar(20) DEFAULT NULL,
  `tax_code` varchar(12) DEFAULT NULL,
  `tax_total` varchar(15) DEFAULT NULL,
  `tax_gst` varchar(15) DEFAULT NULL,
  `tax_pst` varchar(15) DEFAULT NULL,
  `tax_amount` varchar(15) DEFAULT NULL,
  `subtotal_amount` varchar(15) DEFAULT NULL,
  `total_amount` varchar(15) DEFAULT NULL,
  `chk_project_reading` int(11) DEFAULT NULL,
  `chk_project_photos` int(11) DEFAULT NULL,
  `chk_project_signoff` int(11) DEFAULT NULL,
  `rejected_count` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `tjx_sub_invoice`
--

/*!40000 ALTER TABLE `tjx_sub_invoice` DISABLE KEYS */;
INSERT INTO `tjx_sub_invoice` VALUES (1,1,'Emergency circuit tested and tagged; report signed by site contact.','Luminaire extérieur remplacé, façade ô côté cour.','2025-03-01',1,'2025-03-01 09:30:00',1,'INV-4100',1001,'HST','0.00','12.50','$95.00',NULL,'1,234.50','0.00',1,NULL,1,1),(2,2,'Customer approved the repair by email; completion photo attached.','Luminaire extérieur remplacé, façade ô côté cour.','2025-03-02',2,'2025-03-02 09:30:00',2,'INV-4101',1002,'HST','12.50','410.00','45.00','0.00','45.00','1,234.50',2,2,NULL,2);
/*!40000 ALTER TABLE `tjx_sub_invoice` ENABLE KEYS */;


--
-- Table structure for table `tjx_subcontractor_rates`
--

DROP TABLE IF EXISTS `tjx_subcontractor_rates`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `tjx_subcontractor_rates` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `partno` varchar(25) NOT NULL,
  `subid` int(11) NOT NULL,
  `installcostperunit` varchar(15) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `tjx_subcontractor_rates`
--

/*!40000 ALTER TABLE `tjx_subcontractor_rates` DISABLE KEYS */;
INSERT INTO `tjx_subcontractor_rates` VALUES (1,'CLS-1001',1,'45.00'),(2,'CLS-1002',2,'12.50');
/*!40000 ALTER TABLE `tjx_subcontractor_rates` ENABLE KEYS */;


--
-- Table structure for table `tjx_room`
--

DROP TABLE IF EXISTS `tjx_room`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `tjx_room` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `roomname` varchar(80) DEFAULT NULL,
  `sortorder` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `tjx_room`
--

/*!40000 ALTER TABLE `tjx_room` DISABLE KEYS */;
/*!40000 ALTER TABLE `tjx_room` ENABLE KEYS */;


--
-- Table structure for table `tjx_fixture`
--

DROP TABLE IF EXISTS `tjx_fixture`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `tjx_fixture` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `fixturename` varchar(80) DEFAULT NULL,
  `sortorder` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `tjx_fixture`
--

/*!40000 ALTER TABLE `tjx_fixture` DISABLE KEYS */;
/*!40000 ALTER TABLE `tjx_fixture` ENABLE KEYS */;


--
-- Table structure for table `tjx_rooms_template`
--

DROP TABLE IF EXISTS `tjx_rooms_template`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `tjx_rooms_template` (
  `roomid` int(11) DEFAULT NULL,
  `sortorder` int(11) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `tjx_rooms_template`
--

/*!40000 ALTER TABLE `tjx_rooms_template` DISABLE KEYS */;
/*!40000 ALTER TABLE `tjx_rooms_template` ENABLE KEYS */;


--
-- Table structure for table `tjx_fixture_per_quote`
--

DROP TABLE IF EXISTS `tjx_fixture_per_quote`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `tjx_fixture_per_quote` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `fixtureid` int(11) DEFAULT NULL,
  `quoteid` int(11) DEFAULT NULL,
  `fixturename` varchar(80) DEFAULT NULL,
  `sortorder` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `tjx_fixture_per_quote`
--

/*!40000 ALTER TABLE `tjx_fixture_per_quote` DISABLE KEYS */;
/*!40000 ALTER TABLE `tjx_fixture_per_quote` ENABLE KEYS */;


--
-- Table structure for table `tjx_fixture_parts_per_quote`
--

DROP TABLE IF EXISTS `tjx_fixture_parts_per_quote`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `tjx_fixture_parts_per_quote` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `partno` varchar(30) DEFAULT NULL,
  `quoteid` int(11) NOT NULL,
  `fixtureid` int(11) DEFAULT NULL,
  `markup` varchar(10) DEFAULT NULL,
  `parttype` enum('ballast','lamp','') DEFAULT NULL,
  `part_ratio_perfixture` varchar(20) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `tjx_fixture_parts_per_quote`
--

/*!40000 ALTER TABLE `tjx_fixture_parts_per_quote` DISABLE KEYS */;
/*!40000 ALTER TABLE `tjx_fixture_parts_per_quote` ENABLE KEYS */;


--
-- Table structure for table `tjx_quote_grid_types`
--

DROP TABLE IF EXISTS `tjx_quote_grid_types`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `tjx_quote_grid_types` (
  `id` tinyint(1) NOT NULL AUTO_INCREMENT,
  `name` varchar(25) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `tjx_quote_grid_types`
--

/*!40000 ALTER TABLE `tjx_quote_grid_types` DISABLE KEYS */;
/*!40000 ALTER TABLE `tjx_quote_grid_types` ENABLE KEYS */;


--
-- Table structure for table `tjx_quote_payterms`
--

DROP TABLE IF EXISTS `tjx_quote_payterms`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `tjx_quote_payterms` (
  `id` tinyint(1) NOT NULL AUTO_INCREMENT,
  `name` varchar(25) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `tjx_quote_payterms`
--

/*!40000 ALTER TABLE `tjx_quote_payterms` DISABLE KEYS */;
/*!40000 ALTER TABLE `tjx_quote_payterms` ENABLE KEYS */;


--
-- Table structure for table `tjx_prices_per_quote`
--

DROP TABLE IF EXISTS `tjx_prices_per_quote`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `tjx_prices_per_quote` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `quoteid` int(11) NOT NULL,
  `partno` varchar(20) NOT NULL,
  `price` varchar(25) DEFAULT NULL,
  `last_price` varchar(25) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `tjx_prices_per_quote`
--

/*!40000 ALTER TABLE `tjx_prices_per_quote` DISABLE KEYS */;
/*!40000 ALTER TABLE `tjx_prices_per_quote` ENABLE KEYS */;


--
-- Table structure for table `tjx_quote_parts`
--

DROP TABLE IF EXISTS `tjx_quote_parts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `tjx_quote_parts` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `quoteid` int(11) NOT NULL,
  `partno` varchar(30) NOT NULL,
  `fixtured_partno` varchar(30) DEFAULT NULL,
  `qty` int(11) NOT NULL,
  `without_markup_qty` int(11) DEFAULT NULL,
  `price` decimal(7,2) DEFAULT NULL,
  `sortorder` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `tjx_quote_parts`
--

/*!40000 ALTER TABLE `tjx_quote_parts` DISABLE KEYS */;
/*!40000 ALTER TABLE `tjx_quote_parts` ENABLE KEYS */;


--
-- Table structure for table `tjx_quote_soparts`
--

DROP TABLE IF EXISTS `tjx_quote_soparts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `tjx_quote_soparts` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `quoteid` int(11) NOT NULL,
  `name` varchar(150) DEFAULT NULL,
  `qty` int(11) DEFAULT NULL,
  `price` decimal(7,2) DEFAULT NULL,
  `sortorder` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `tjx_quote_soparts`
--

/*!40000 ALTER TABLE `tjx_quote_soparts` DISABLE KEYS */;
/*!40000 ALTER TABLE `tjx_quote_soparts` ENABLE KEYS */;


--
-- Table structure for table `tjx_quote_extra_workorders`
--

DROP TABLE IF EXISTS `tjx_quote_extra_workorders`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `tjx_quote_extra_workorders` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `quoteid` int(11) DEFAULT NULL,
  `woid` int(11) DEFAULT NULL,
  `is_project_workorder` int(11) DEFAULT NULL,
  `sortorder` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `tjx_quote_extra_workorders`
--

/*!40000 ALTER TABLE `tjx_quote_extra_workorders` DISABLE KEYS */;
/*!40000 ALTER TABLE `tjx_quote_extra_workorders` ENABLE KEYS */;


--
-- Table structure for table `tjx_quote_lastused_sharedpart`
--

DROP TABLE IF EXISTS `tjx_quote_lastused_sharedpart`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `tjx_quote_lastused_sharedpart` (
  `quoteid` int(11) NOT NULL,
  `used_partcode` varchar(15) NOT NULL,
  `main_partcode` varchar(15) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `tjx_quote_lastused_sharedpart`
--

/*!40000 ALTER TABLE `tjx_quote_lastused_sharedpart` DISABLE KEYS */;
/*!40000 ALTER TABLE `tjx_quote_lastused_sharedpart` ENABLE KEYS */;


--
-- Table structure for table `tjx_quote_downloads`
--

DROP TABLE IF EXISTS `tjx_quote_downloads`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `tjx_quote_downloads` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `quoteid` int(11) DEFAULT NULL,
  `filename` varchar(50) DEFAULT NULL,
  `downloadbyname` varchar(30) DEFAULT NULL,
  `foldername` varchar(20) DEFAULT NULL,
  `datecreated` datetime DEFAULT NULL,
  `download_revision_notes` text DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `tjx_quote_downloads`
--

/*!40000 ALTER TABLE `tjx_quote_downloads` DISABLE KEYS */;
/*!40000 ALTER TABLE `tjx_quote_downloads` ENABLE KEYS */;


--
-- Table structure for table `tjx_sub_invoice_fixtures`
--

DROP TABLE IF EXISTS `tjx_sub_invoice_fixtures`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `tjx_sub_invoice_fixtures` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `invoiceid` int(11) DEFAULT NULL,
  `roomid` int(11) DEFAULT NULL,
  `otherroom` varchar(100) DEFAULT NULL,
  `fixtureid` int(11) DEFAULT NULL,
  `totalfixtures` varchar(30) DEFAULT NULL,
  `installedqty_totalfixtures` varchar(30) DEFAULT NULL,
  `quoted_roomid` int(11) DEFAULT NULL,
  `quoted_fixtureid` int(11) DEFAULT NULL,
  `discrepancy_notes` text DEFAULT NULL,
  `tjx_quote_fixture_rowid` int(11) DEFAULT NULL,
  `quoteid` int(11) DEFAULT NULL,
  `woid` varchar(15) DEFAULT NULL,
  `sortorder` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `tjx_sub_invoice_fixtures`
--

/*!40000 ALTER TABLE `tjx_sub_invoice_fixtures` DISABLE KEYS */;
/*!40000 ALTER TABLE `tjx_sub_invoice_fixtures` ENABLE KEYS */;


--
-- Table structure for table `tjx_sub_invoice_revisions`
--

DROP TABLE IF EXISTS `tjx_sub_invoice_revisions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `tjx_sub_invoice_revisions` (
  `revision_id` int(11) NOT NULL AUTO_INCREMENT,
  `invoiceid` int(11) DEFAULT NULL,
  `workordernumber` varchar(30) DEFAULT NULL,
  `created_time` timestamp DEFAULT NULL,
  `revised_by_user` int(11) DEFAULT NULL,
  `revision_type` varchar(45) DEFAULT NULL,
  `data_invoice` text DEFAULT NULL,
  `data_fixtures` longtext DEFAULT NULL,
  `data_parts` longtext DEFAULT NULL,
  `data_soparts` text DEFAULT NULL,
  PRIMARY KEY (`revision_id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `tjx_sub_invoice_revisions`
--

/*!40000 ALTER TABLE `tjx_sub_invoice_revisions` DISABLE KEYS */;
/*!40000 ALTER TABLE `tjx_sub_invoice_revisions` ENABLE KEYS */;


--
-- Table structure for table `tjx_wo_parts`
--

DROP TABLE IF EXISTS `tjx_wo_parts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `tjx_wo_parts` (
  `id` int(12) NOT NULL AUTO_INCREMENT,
  `woid` int(11) NOT NULL,
  `partno` varchar(50) NOT NULL,
  `partno_used_infixutre` varchar(50) DEFAULT NULL,
  `qty` decimal(7,2) NOT NULL,
  `price` decimal(7,2) DEFAULT NULL,
  `sortorder` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `tjx_wo_parts`
--

/*!40000 ALTER TABLE `tjx_wo_parts` DISABLE KEYS */;
/*!40000 ALTER TABLE `tjx_wo_parts` ENABLE KEYS */;


--
-- Table structure for table `tjx_wo_soparts`
--

DROP TABLE IF EXISTS `tjx_wo_soparts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `tjx_wo_soparts` (
  `id` int(120) NOT NULL AUTO_INCREMENT,
  `woid` int(10) NOT NULL,
  `name` varchar(100) NOT NULL,
  `qty` decimal(7,2) NOT NULL,
  `price` decimal(7,2) NOT NULL,
  `sortorder` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `tjx_wo_soparts`
--

/*!40000 ALTER TABLE `tjx_wo_soparts` DISABLE KEYS */;
/*!40000 ALTER TABLE `tjx_wo_soparts` ENABLE KEYS */;


--
-- Table structure for table `messages`
--

DROP TABLE IF EXISTS `messages`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `messages` (
  `id` int(100) NOT NULL AUTO_INCREMENT,
  `sender` varchar(100) NOT NULL,
  `receiver` varchar(100) NOT NULL,
  `subject` varchar(100) NOT NULL,
  `datetime` varchar(100) NOT NULL,
  `message` text NOT NULL,
  `read` smallint(10) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `messages`
--

/*!40000 ALTER TABLE `messages` DISABLE KEYS */;
INSERT INTO `messages` VALUES (1,'Interior','Scheduled','Priya Raman','2025-03-01 09:15:00','Vérifier le câblage et la boîte de jonction avant la prochaine visite.',1),(2,'North','North','Priya Raman','2025-03-02 09:15:00','Luminaire extérieur remplacé, façade ô côté cour.',2),(3,'Interior','North','Marc Tremblay','2025-03-03 09:15:00','Vérifier le câblage et la boîte de jonction avant la prochaine visite.',3),(4,'North','Standard','Hélène Girard','2025-03-04 09:15:00','Customer approved the repair by email; completion photo attached.',4),(5,'CLS','North','Luc Côté','2025-03-05 09:15:00','Replaced driver and verified output on all four fixtures.',5);
/*!40000 ALTER TABLE `messages` ENABLE KEYS */;


--
-- Table structure for table `messages_links`
--

DROP TABLE IF EXISTS `messages_links`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `messages_links` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `woid` int(11) DEFAULT NULL,
  `confirmation_key` text DEFAULT NULL,
  `message_text` text DEFAULT NULL,
  `message_title` varchar(100) DEFAULT NULL,
  `date` timestamp DEFAULT NULL,
  `is_responded` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `messages_links`
--

/*!40000 ALTER TABLE `messages_links` DISABLE KEYS */;
INSERT INTO `messages_links` VALUES (1,1001,NULL,'Customer approved the repair by email; completion photo attached.','Pending','2025-03-01 09:30:00',1),(2,1002,NULL,'Emergency circuit tested and tagged; report signed by site contact.','Interior','2025-03-02 09:30:00',2),(3,1003,'Luminaire extérieur remplacé, façade ô côté cour.','Emergency circuit tested and tagged; report signed by site contact.','Maintenance',NULL,3),(4,1004,'Replaced driver and verified output on all four fixtures.','Commande reçue partielle, reste 2 unités en reliquat.',NULL,'2025-03-04 09:30:00',4);
/*!40000 ALTER TABLE `messages_links` ENABLE KEYS */;


--
-- Table structure for table `messages_links_po`
--

DROP TABLE IF EXISTS `messages_links_po`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `messages_links_po` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `poid` int(11) DEFAULT NULL,
  `confirmation_key` text DEFAULT NULL,
  `message_text` text DEFAULT NULL,
  `message_title` varchar(100) DEFAULT NULL,
  `date` timestamp DEFAULT NULL,
  `is_responded` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `messages_links_po`
--

/*!40000 ALTER TABLE `messages_links_po` DISABLE KEYS */;
INSERT INTO `messages_links_po` VALUES (1,1,'Luminaire extérieur remplacé, façade ô côté cour.','Vérifier le câblage et la boîte de jonction avant la prochaine visite.','North','2025-03-01 09:30:00',1),(2,2,NULL,'Vérifier le câblage et la boîte de jonction avant la prochaine visite.','Completed','2025-03-02 09:30:00',2);
/*!40000 ALTER TABLE `messages_links_po` ENABLE KEYS */;


--
-- Table structure for table `po_notification`
--

DROP TABLE IF EXISTS `po_notification`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `po_notification` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `poid` int(11) NOT NULL,
  `notify_type` varchar(10) DEFAULT NULL,
  `user_id` int(11) NOT NULL,
  `is_notified` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `po_notification`
--

/*!40000 ALTER TABLE `po_notification` DISABLE KEYS */;
INSERT INTO `po_notification` VALUES (1,1,'email',1,1),(2,2,'email',2,NULL),(3,3,'email',3,3);
/*!40000 ALTER TABLE `po_notification` ENABLE KEYS */;


--
-- Table structure for table `rga_notification`
--

DROP TABLE IF EXISTS `rga_notification`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `rga_notification` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `rgaid` int(11) NOT NULL,
  `notify_type` varchar(30) DEFAULT NULL,
  `user_id` int(11) NOT NULL,
  `is_notified` int(11) DEFAULT NULL,
  `notify_date` date DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `rga_notification`
--

/*!40000 ALTER TABLE `rga_notification` DISABLE KEYS */;
INSERT INTO `rga_notification` VALUES (1,1,'email',1,NULL,'2025-03-01'),(2,2,'email',2,2,'2025-03-02'),(3,3,'email',3,3,NULL);
/*!40000 ALTER TABLE `rga_notification` ENABLE KEYS */;


--
-- Table structure for table `cron_run_history`
--

DROP TABLE IF EXISTS `cron_run_history`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `cron_run_history` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `cronname` varchar(50) DEFAULT NULL,
  `execute_timeint` bigint(20) DEFAULT NULL,
  `runtime` varchar(50) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `cron_run_history`
--

/*!40000 ALTER TABLE `cron_run_history` DISABLE KEYS */;
INSERT INTO `cron_run_history` VALUES (1,'signoff_cron',1735689600,'00:01:12'),(2,'price_history_cron',1735776000,'00:00:04'),(3,'signoff_cron',1735862400,'00:01:12');
/*!40000 ALTER TABLE `cron_run_history` ENABLE KEYS */;


--
-- Table structure for table `site_activity_logs`
--

DROP TABLE IF EXISTS `site_activity_logs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `site_activity_logs` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `row_id` int(11) DEFAULT NULL,
  `table_name` varchar(50) DEFAULT NULL,
  `log_type` varchar(80) DEFAULT NULL,
  `user_id` int(11) DEFAULT NULL,
  `log_date` datetime DEFAULT NULL,
  `php_filename` varchar(100) DEFAULT NULL,
  `section` varchar(50) DEFAULT NULL,
  `notes_comments` text DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `site_activity_logs`
--

/*!40000 ALTER TABLE `site_activity_logs` DISABLE KEYS */;
INSERT INTO `site_activity_logs` VALUES (1,1,NULL,'Replaced driver and verified output on all four fixtures.',1,'2025-03-01 09:30:00','wp-admin/workorders/update.php','workorder','Commande reçue partielle, reste 2 unités en reliquat.'),(2,2,'workorder','Commande reçue partielle, reste 2 unités en reliquat.',2,'2025-03-02 09:30:00','wp-admin/workorders/update.php','','Emergency circuit tested and tagged; report signed by site contact.'),(3,3,'workorder','Emergency circuit tested and tagged; report signed by site contact.',3,'2025-03-03 09:30:00','','workorder','Vérifier le câblage et la boîte de jonction avant la prochaine visite.');
/*!40000 ALTER TABLE `site_activity_logs` ENABLE KEYS */;


--
-- Table structure for table `message_setup`
--

DROP TABLE IF EXISTS `message_setup`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `message_setup` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `userid` int(11) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `message_setup`
--

/*!40000 ALTER TABLE `message_setup` DISABLE KEYS */;
/*!40000 ALTER TABLE `message_setup` ENABLE KEYS */;


--
-- Table structure for table `email_messages_to_sub`
--

DROP TABLE IF EXISTS `email_messages_to_sub`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `email_messages_to_sub` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `sender_id` int(10) NOT NULL,
  `sender` varchar(50) DEFAULT NULL,
  `subid` int(10) NOT NULL,
  `receiver_emails` varchar(200) NOT NULL,
  `subject` varchar(200) NOT NULL,
  `datetime` int(11) NOT NULL,
  `message` text NOT NULL,
  `file_attachments` text DEFAULT NULL,
  `parent_id` int(11) DEFAULT NULL,
  `confirmation_key` text DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `email_messages_to_sub`
--

/*!40000 ALTER TABLE `email_messages_to_sub` DISABLE KEYS */;
/*!40000 ALTER TABLE `email_messages_to_sub` ENABLE KEYS */;


--
-- Table structure for table `sub_stock_messages`
--

DROP TABLE IF EXISTS `sub_stock_messages`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `sub_stock_messages` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `notification_id` int(11) DEFAULT NULL,
  `subid` int(11) DEFAULT NULL,
  `userid` int(11) DEFAULT NULL,
  `usertype` enum('','sub','admin') DEFAULT NULL,
  `username` varchar(30) DEFAULT NULL,
  `message_subject` text DEFAULT NULL,
  `message_text` text NOT NULL,
  `is_read` tinyint(4) DEFAULT NULL,
  `is_read_by` int(11) DEFAULT NULL,
  `date_created` datetime DEFAULT NULL,
  `confirmation_key` varchar(50) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `sub_stock_messages`
--

/*!40000 ALTER TABLE `sub_stock_messages` DISABLE KEYS */;
/*!40000 ALTER TABLE `sub_stock_messages` ENABLE KEYS */;


--
-- Table structure for table `sub_stock_notification`
--

DROP TABLE IF EXISTS `sub_stock_notification`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `sub_stock_notification` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `userid` int(11) DEFAULT NULL,
  `subid` int(11) DEFAULT NULL,
  `contain_stock` int(11) DEFAULT NULL,
  `notification_code` varchar(10) NOT NULL,
  `date_created` datetime DEFAULT NULL,
  `is_responded` int(11) DEFAULT NULL,
  `stockfilename` varchar(50) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `sub_stock_notification`
--

/*!40000 ALTER TABLE `sub_stock_notification` DISABLE KEYS */;
/*!40000 ALTER TABLE `sub_stock_notification` ENABLE KEYS */;


--
-- Table structure for table `inv_parts_july_20_2025`
--

DROP TABLE IF EXISTS `inv_parts_july_20_2025`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `inv_parts_july_20_2025` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `woid` int(11) NOT NULL,
  `partno` varchar(20) NOT NULL,
  `qty` decimal(7,2) NOT NULL,
  `price` decimal(11,2) NOT NULL,
  `entered_price` varchar(12) DEFAULT NULL,
  `linked_sopart_cost_price` varchar(30) DEFAULT NULL,
  `linked_part_sopart` varchar(20) DEFAULT NULL,
  `is_local_part` int(11) DEFAULT NULL,
  `applied_woid` varchar(20) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `inv_parts_july_20_2025`
--

/*!40000 ALTER TABLE `inv_parts_july_20_2025` DISABLE KEYS */;
INSERT INTO `inv_parts_july_20_2025` VALUES (1,1001,'CLS-1001',1.00,15.80,'1,234.50','45.00','Emergency light head',1,1001);
/*!40000 ALTER TABLE `inv_parts_july_20_2025` ENABLE KEYS */;


--
-- Table structure for table `parts_backup_17dec25`
--

DROP TABLE IF EXISTS `parts_backup_17dec25`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `parts_backup_17dec25` (
  `name` text DEFAULT NULL,
  `number` varchar(50) DEFAULT NULL,
  `cost` decimal(7,2) DEFAULT NULL,
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `subignore` tinyint(3) DEFAULT NULL,
  `sell_price` decimal(7,2) DEFAULT NULL,
  `sage_id` int(11) DEFAULT NULL,
  `part_group_id` int(11) DEFAULT NULL,
  `warranty` varchar(75) DEFAULT NULL,
  `labor_warranty` varchar(75) DEFAULT NULL,
  `purchased_quantity` decimal(7,2) DEFAULT NULL,
  `current_quantity` decimal(7,2) DEFAULT NULL,
  `sold_quantity` decimal(7,2) DEFAULT NULL,
  `installcostperunit` varchar(15) DEFAULT NULL,
  `install_profit_formula` varchar(50) DEFAULT NULL,
  `recycle_profit_formula` varchar(50) DEFAULT NULL,
  `saved_sage_price` varchar(50) DEFAULT NULL,
  `is_sage_saved` int(11) DEFAULT NULL,
  `part_popup_notes` text DEFAULT NULL,
  `parent_partnumber` varchar(50) DEFAULT NULL,
  `cls_linked_partcode` varchar(20) DEFAULT NULL,
  `active_in_sage` int(11) DEFAULT NULL,
  `defaultsortorder` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `parts_backup_17dec25`
--

/*!40000 ALTER TABLE `parts_backup_17dec25` DISABLE KEYS */;
INSERT INTO `parts_backup_17dec25` VALUES ('Ballast 2-lamp T8 electronic','CLS-1001',13.86,1,1,16.49,1,1,'Scheduled','Alliance',1.00,1.00,1.00,NULL,'45.00','12.50',NULL,1,'Replaced driver and verified output on all four fixtures.',NULL,'CLS-1003',1,1);
/*!40000 ALTER TABLE `parts_backup_17dec25` ENABLE KEYS */;


--
-- Table structure for table `po_status_v2`
--

DROP TABLE IF EXISTS `po_status_v2`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `po_status_v2` (
  `id` tinyint(1) NOT NULL AUTO_INCREMENT,
  `name` varchar(25) NOT NULL,
  `sorting_order` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `po_status_v2`
--

/*!40000 ALTER TABLE `po_status_v2` DISABLE KEYS */;
INSERT INTO `po_status_v2` VALUES (1,'Draft',1);
/*!40000 ALTER TABLE `po_status_v2` ENABLE KEYS */;


--
-- Table structure for table `workorder_backup_2025`
--

DROP TABLE IF EXISTS `workorder_backup_2025`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = latin1 */;
CREATE TABLE `workorder_backup_2025` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `site` int(11) NOT NULL,
  `servicetype` tinyint(2) NOT NULL,
  `priority` tinyint(2) NOT NULL,
  `dne` int(11) NOT NULL,
  `status` tinyint(2) NOT NULL,
  `datetaken` date NOT NULL,
  `expcompletion` date NOT NULL,
  `servicerequired` text NOT NULL,
  `notes` text DEFAULT NULL,
  `subcontractor` int(11) DEFAULT NULL,
  `completiondate` varchar(120) DEFAULT NULL,
  `securitycode` varchar(100) DEFAULT NULL,
  `customerpo` varchar(100) DEFAULT NULL,
  `local` tinyint(3) NOT NULL,
  `tech` int(4) DEFAULT NULL,
  `tech_2` int(11) DEFAULT NULL,
  `tech_labour_rate` decimal(7,2) DEFAULT NULL,
  `invdate` date DEFAULT NULL,
  `calc_inv_date` date DEFAULT NULL,
  `customer` int(11) DEFAULT NULL,
  `wo_folder_attach_path` varchar(200) DEFAULT NULL,
  `printed` varchar(10) DEFAULT NULL,
  `batched` date DEFAULT NULL,
  `schannel` int(1) NOT NULL,
  `schannel_redone` int(11) DEFAULT NULL,
  `sgsales_done` int(11) DEFAULT NULL,
  `sgpurch_done` int(11) DEFAULT NULL,
  `forced_enable_sc_transfer` int(11) DEFAULT NULL,
  `ready_for_calc_timespan` bigint(20) DEFAULT NULL,
  `closeout_tech` int(11) DEFAULT NULL,
  `closeout_tech_2` int(11) DEFAULT NULL,
  `is_marked_red` int(11) DEFAULT NULL,
  `is_marked_green` int(11) DEFAULT NULL,
  `is_marked_critical` int(11) DEFAULT NULL,
  `is_project_wo` tinyint(4) DEFAULT NULL,
  `customer_quote_id` varchar(50) DEFAULT NULL,
  `is_tjx_quote` int(11) DEFAULT NULL,
  `is_pma_order` tinyint(1) DEFAULT NULL,
  `is_pma_bckup` varchar(12) DEFAULT NULL,
  `stock_updated` int(11) DEFAULT NULL,
  `marked_invoiced_time` int(11) DEFAULT NULL,
  `enable_sale_stock_upd_btn` int(11) DEFAULT NULL,
  `only_portal_stock_updated` int(11) DEFAULT NULL,
  `assigned_dispatch_id` int(11) DEFAULT NULL,
  `pma_order_category` varchar(25) DEFAULT NULL,
  `primary_workorder` varchar(20) DEFAULT NULL,
  `add_to_local_modify_once` int(11) DEFAULT NULL,
  `sc_primary_status` varchar(20) DEFAULT NULL,
  `sc_extended_status` varchar(20) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `workorder_backup_2025`
--

/*!40000 ALTER TABLE `workorder_backup_2025` DISABLE KEYS */;
INSERT INTO `workorder_backup_2025` VALUES (1,1,1,1,1,1,'2025-03-01','2025-03-01','Customer approved the repair by email; completion photo attached.','Customer approved the repair by email; completion photo attached.',1,'2025-03-01','SC-4000','',1,1,1,14.94,NULL,'2025-03-01',1,'Alliance','1','2025-03-01',1,1,1,NULL,1,1,1,NULL,1,1,1,NULL,1,NULL,NULL,'0',1,1,1,1,1,'Fire Alarm','1001',1,'new',NULL);
/*!40000 ALTER TABLE `workorder_backup_2025` ENABLE KEYS */;


/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-11-12  0:00:00
