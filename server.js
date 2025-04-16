const express = require('express');
const mysql = require('mysql2'); // use mysql2 for newer MySQL versions
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
const port = 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public')); // where your HTML files go

// MySQL connection
const db = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: 'abcd1234',
  database: 'pharmacy' // replace if your DB is named differently
});

db.connect(err => {
  if (err) {
    console.error('Database connection failed:', err);
    return;
  }
  console.log('Connected to MySQL');
});

// Route to add a doctor
app.post('/add-doctor', (req, res) => {
  const { name, specialization, license, contact, email } = req.body;
  const sql = `
    INSERT INTO doctors (name, specialization, license_number, contact, email)
    VALUES (?, ?, ?, ?, ?)
  `;
  db.query(sql, [name, specialization, license, contact, email], (err) => {
    if (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return res.status(400).send('Doctor already exists.');
      }
      console.error(err);
      return res.status(500).send('Error adding doctor.');
    }
    res.send('Doctor added successfully!');
  });
});

// Route to add a medicine
app.post('/add-medicine', (req, res) => {
  const { name, brand, price, stock, expiry_date } = req.body;
  const sql = `
    INSERT INTO medicines (name, brand, price, stock, expiry_date)
    VALUES (?, ?, ?, ?, ?)
  `;
  db.query(sql, [name, brand, price, stock, expiry_date], (err) => {
    if (err) {
      console.error(err);
      return res.status(500).send('Error adding medicine.');
    }
    res.send('Medicine added successfully!');
  });
});

// Route to add a patient
app.post('/add-patient', (req, res) => {
  const { name, dob, gender, contact, email } = req.body;
  const sql = `
    INSERT INTO patients (name, dob, gender, contact, email)
    VALUES (?, ?, ?, ?, ?)
  `;
  db.query(sql, [name, dob, gender, contact, email], (err) => {
    if (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return res.status(400).send('Patient with this email already exists.');
      }
      console.error(err);
      return res.status(500).send('Error adding patient.');
    }
    res.send('Patient added successfully!');
  });
});

// Route to add a prescription
app.post('/add-prescription', (req, res) => {
  const { prescription, medicines } = req.body;
  
  // Start a transaction
  db.beginTransaction(err => {
    if (err) {
      console.error('Error starting transaction:', err);
      return res.status(500).send('Error creating prescription.');
    }

    // First, insert the prescription
    const prescriptionSql = `
      INSERT INTO prescriptions (doctor_id, patient_id, notes)
      VALUES (?, ?, ?)
    `;
    
    db.query(prescriptionSql, [prescription.doctor_id, prescription.patient_id, prescription.notes], (err, result) => {
      if (err) {
        db.rollback(() => {
          console.error('Error inserting prescription:', err);
          res.status(500).send('Error creating prescription.');
        });
        return;
      }

      const prescriptionId = result.insertId;
      let errorOccurred = false;

      // Then, insert each medicine detail
      medicines.forEach(medicine => {
        const detailSql = `
          INSERT INTO prescription_details (prescription_id, medicine_id, dosage, quantity)
          VALUES (?, ?, ?, ?)
        `;
        
        db.query(detailSql, [prescriptionId, medicine.medicine_id, medicine.dosage, medicine.quantity], (err) => {
          if (err) {
            errorOccurred = true;
            db.rollback(() => {
              console.error('Error inserting prescription details:', err);
              res.status(500).send('Error adding medicine details.');
            });
            return;
          }
        });
      });

      if (!errorOccurred) {
        db.commit(err => {
          if (err) {
            db.rollback(() => {
              console.error('Error committing transaction:', err);
              res.status(500).send('Error saving prescription.');
            });
            return;
          }
          res.send('Prescription added successfully!');
        });
      }
    });
  });
});

app.post('/generate-bill/:id', (req, res) => {
    const prescriptionId = req.params.id;
  
    // Step 1: Call the stored procedure
    db.query('CALL generate_bill(?)', [prescriptionId], (err) => {
      if (err) {
        console.error('Error generating bill:', err);
        return res.status(500).json({ error: 'Failed to generate bill.' });
      }
  
      // Step 2: Fetch the generated bill with patient and doctor details
      const query = `
        SELECT 
          s.sale_id,
          s.sale_date,
          s.total_amount,
          p.name as patient_name,
          p.contact as patient_contact,
          d.name as doctor_name,
          pr.issue_date as prescription_date,
          m.name as medicine_name,
          pd.quantity,
          CAST(m.price AS DECIMAL(10,2)) as price
        FROM sales s
        JOIN prescriptions pr ON s.prescription_id = pr.prescription_id
        JOIN patients p ON pr.patient_id = p.patient_id
        JOIN doctors d ON pr.doctor_id = d.doctor_id
        JOIN prescription_details pd ON pr.prescription_id = pd.prescription_id
        JOIN medicines m ON pd.medicine_id = m.medicine_id
        WHERE s.prescription_id = ?
        ORDER BY s.sale_id DESC LIMIT 1
      `;
      
      db.query(query, [prescriptionId], (err, results) => {
        if (err || results.length === 0) {
          console.error('Error fetching bill:', err);
          return res.status(500).json({ error: 'Bill generated, but unable to retrieve details.' });
        }
  
        // Group medicines by sale
        const medicines = results.map(row => ({
          name: row.medicine_name,
          quantity: parseInt(row.quantity),
          price: parseFloat(row.price)
        }));
  
        const bill = {
          sale_id: results[0].sale_id,
          sale_date: results[0].sale_date,
          total_amount: parseFloat(results[0].total_amount),
          patient_name: results[0].patient_name,
          patient_contact: results[0].patient_contact,
          doctor_name: results[0].doctor_name,
          prescription_date: results[0].prescription_date,
          medicines: medicines
        };
  
        res.json(bill);
      });
    });
});

// Route to fetch low stock medicines
app.get('/view/low-stock', (req, res) => {
    db.query('SELECT * FROM low_stock_medicines', (err, results) => {
      if (err) {
        console.error('Error fetching low stock:', err);
        return res.status(500).json({ error: 'Failed to retrieve low stock data.' });
      }
      res.json(results);
    });
  });
  
  // Route to fetch expired medicines
  app.get('/view/expired', (req, res) => {
    db.query('SELECT * FROM expired_medicines', (err, results) => {
      if (err) {
        console.error('Error fetching expired medicines:', err);
        return res.status(500).json({ error: 'Failed to retrieve expired medicine data.' });
      }
      res.json(results);
    });
  });

// Route to get all patients
app.get('/get-patients', (req, res) => {
    const sql = 'SELECT patient_id, name FROM patients ORDER BY name';
    db.query(sql, (err, results) => {
        if (err) {
            console.error('Error fetching patients:', err);
            return res.status(500).json({ error: 'Failed to fetch patients.' });
        }
        res.json(results);
    });
});

// Route to get all doctors
app.get('/get-doctors', (req, res) => {
    const sql = 'SELECT doctor_id, name FROM doctors ORDER BY name';
    db.query(sql, (err, results) => {
        if (err) {
            console.error('Error fetching doctors:', err);
            return res.status(500).json({ error: 'Failed to fetch doctors.' });
        }
        res.json(results);
    });
});

// Route to get all medicines
app.get('/get-medicines', (req, res) => {
    const sql = 'SELECT medicine_id, name, brand, price, stock FROM medicines ORDER BY name';
    db.query(sql, (err, results) => {
        if (err) {
            console.error('Error fetching medicines:', err);
            return res.status(500).json({ error: 'Failed to fetch medicines.' });
        }
        res.json(results);
    });
});

// Route to get all prescriptions
app.get('/get-prescriptions', (req, res) => {
    const sql = `
        SELECT p.prescription_id, p.issue_date, 
               pat.name as patient_name, 
               doc.name as doctor_name
        FROM prescriptions p
        JOIN patients pat ON p.patient_id = pat.patient_id
        JOIN doctors doc ON p.doctor_id = doc.doctor_id
        ORDER BY p.issue_date DESC
    `;
    db.query(sql, (err, results) => {
        if (err) {
            console.error('Error fetching prescriptions:', err);
            return res.status(500).json({ error: 'Failed to fetch prescriptions.' });
        }
        res.json(results);
    });
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
