const express = require('express')
const bparser = require('body-parser')
const bcrypt = require('bcrypt-nodejs')
const cors = require('cors')
const knex = require('knex')
const aws = require('aws-sdk')
require('dotenv').config(); // Configure dotenv to load in the .env file
const S3_BUCKET = process.env.S3_BUCKET
const db = knex({
    client: 'pg',
    connection: {
      connectionString : process.env.DATABASE_URL,
      ssl : true
    }
});

aws.config.update({
    region: process.env.REGION,
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    signatureVersion: 'v4'
})


const app = express();
app.use(bparser.json());
app.use(cors());

// root ----------------------

app.get('/',(req,res) =>{
    res.json('memriio is live : getsignedfileURL 4')
})

// signin ----------------------

app.post('/signin',(req,res) => {
    
    
    db.select('email','hash').from('login').where({email:req.body.email})
        .then(data=>{
           
        const isValid = bcrypt.compareSync(req.body.password,data[0].hash)
        
        if(isValid){
            return db.select('*').from('users').where({email:req.body.email})
            .then(user =>{
                res.status(200).json(user[0])
            }).catch(err => res.status(400).json('Error Signing In'))  
        }else{
            res.status(401).json('Wrong credentials')
        }
    }).catch(err=> res.status(400).json('wrong Credentials'))
})

// register ----------------------------------------------------------------

app.post('/register',(req,res) => {
    const {email,firstname,lastname,password} = req.body
    const hash = bcrypt.hashSync(password)
    // use transactions to guarentee success accross two tables
    db.transaction(trx =>{
        trx.insert({
            hash:hash,
            email:email,
            password:password
        })
        .into('login')
        .returning('email')
        .then(loginEmail =>{
            return trx('users')
            .returning('*')
            .insert({
                firstname:firstname,
                lastname:lastname,
                email:loginEmail[0],
                joined:new Date()
        })
            .then(user=> {
                res.json(user[0])
            })
        })
        .then(trx.commit)
        .catch(trx.rollback)
    })
    .then()
    
})

// get signed URL FROM AWS ----------------------------------------------------------------

app.post ('/signedurl',(req,res) =>{

    console.log('made it to getSignedURL', req.body);

    

    const s3 = new aws.S3(); // Create a new instance of S3
    const fileName = req.body.fileName;
    const fileType = req.body.fileType;

    console.log('filename :',fileName)

    const s3Params = {
        Bucket: S3_BUCKET,
        Key: fileName,
        Expires: 500,
        ContentType: fileType,
        ACL: 'public-read'
    };
    
    s3.getSignedUrl('putObject', s3Params, (err, signedURL) => {
        if (err) {
            console.log('Error in s3.getSignedURL',err);
            res.json({ success: false, error: err });
        }else{
            const returnData = {

                signedRequest: signedURL,
                url: `https://${S3_BUCKET}.s3.amazonaws.com/${fileName}`
            };
            console.log('signedURL : ',returnData.signedRequest);
            console.log('url       : ',returnData.url);
            
            // Send it all back
            res.json( {
                success:true,
                signedURL: returnData.signedRequest,
                url:returnData.url
             }) 
             console.log('res : ', res)
        }
    });

})

// create memory --------------------------------------------------

app.post('/creatememory',(req,res) => {
    const {ispersonal,userid,groupid} = req.body
    
    db('memories')
        .returning('id')
        .insert({
            createdon:new Date(),
            ispersonal:ispersonal,
            userid:userid,
            groupid:groupid
    })
        .then(memoryids=> {
            if(memoryids.length > 0){
                res.json({
                    created:true,
                    id:memoryids[0]
                })
            }else{
                res.json({
                    created:false,
                    id:0
                })
            }
        })
        .catch(err=> json(err))
})

// Add file to memory ---------

app.post('/addmemfile',(req,res) => {
    const{memid,fileurl,ishero} = req.body;
    console.log('addtest 3 :',memid,fileurl,ishero);
    

    db('memfiles').returning('id')
        .insert({
            memid:memid,
            fileurl:fileurl,
            ishero:ishero
        })
        .then(data =>{
            res.status(200).json(data)
        }).catch(err => res.status(400).json(err))
    })  

// Associate key words with a memory ----------------------------------------------------------------

app.post('/associate',(req,res) => {
    const {memid,keyword} = req.body
    
    db('memwords')
        .returning('*')
        .insert({
            memid:memid,
            keyword:keyword
    })
        .then(associate=> {
            res.json(associate[0]);
        })
        .catch(err=> res.status(400).json('unable to associate'))
})

// profile/id ----------------------------------------------------------------

app.get('/profile/:id',(req,res) =>{

    const { id } = req.params;
    
    db.select('*').from('users').where({id:id}).then(users=>{
        if(users.length){
            res.json(users[0])
        }else{
            res.status(400).json('user not found')
        }
    })
    .catch(err=> res.status(400).json('error getting user profile'))
    
})

// memory/id ----------------------------------------------------------------

app.get('/memory/:id',(req,res) =>{

    const { id } = req.params;
    
    db.select('*').from('memories').where({id:id}).then(memories=>{
        if(memories.length){
            res.json(memories[0])
        }else{
            res.status(400).json('memory not found')
        }
    })
    .catch(err=> res.status(400).json('error getting user memory'))
})

// search ----------------------------------------------------------------

app.post('/search',(req,res) =>{

    const {words,user} = req.body

     
    db.select('*').from('memories').whereIn('id',function(){
            this.select('memid').from('memassociates').where('keywords','Like',words.toLowerCase())})
            .andWhere(function(){
                     this.whereIn('memories.groupid',function(){
                         this.select('groupid').from('memberships').where({userid:user})
                     })
                 })
             .union(function(){
                      this.select('*').from('memories').whereIn('id',function(){
                          this.select('memid').from('memassociates').where('keywords','like',words.toLowerCase())
                      .andWhere({groupid:0,userid:user})
                      })
                  })
                
  
        .then(memories=>{
            if(memories.length){
                res.json(memories)
            }else{
                res.status(400).json('no memories found')
            }
        })
    .catch(err=> res.status(400).json('no memories found'))
})

// search user ----------------------------------------------------------------

app.post('/searchuser',(req,res) =>{

    const {userid} = req.body
    
    db.select('memories.id','memories.groupid','memories.userid','memories.title','memfiles.fileurl')
    .from('memories')
    .join('memfiles', {'memfiles.memid':'memories.id'})
    .where({userid:userid})
    .orWhereIn('groupid',function(){this.select('groupid').from('memberships').where({userid:userid})})
    .then(memories=>{
        if(memories.length){
            res.json(memories)
        }else{
            res.status(400).json('no matching memories found')
        }
    }).catch(err=> res.json(err))
})

// Listen ----------------------------------------------------------------

app.listen(process.env.PORT || 3000,()=> {
    console.log('app running on port ${process.env.PORT}');
})

