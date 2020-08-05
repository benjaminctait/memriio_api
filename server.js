const express = require('express')

const bparser = require('body-parser')
const bcrypt = require('bcrypt-nodejs')
const tinify =require('tinify')
const cors = require('cors')
const knex = require('knex')
const aws = require('aws-sdk')
const Jimp = require('jimp')
const { json } = require('body-parser')
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
    signatureVersion: 'v4',
    
})
tinify.key = process.env.TINIFY_API_KEY

const app = express();
app.use(bparser.json({limit: '50mb'}));
app.use(bparser.urlencoded({limit: '50mb', extended: true}));
app.use(express.json());


app.use(cors());

// root ----------------------

app.get('/',(req,res) =>{
    res.json('memriio server is live : version 5')
})

// signin ---------------------------------------------------------------

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


// create a new memory cloud ---------------------------------------------------
// creates a new memory cloud with name : name and administrator : adminid
// then adds adminid as a member of the new cloud
// Pre: adminid must be an existing user
//      name must not equal any existing cloud name

app.post('/createcloud',(req,res) => {
    const {name,adminid} = req.body
    console.log('/createcloud : ' + name + ' admin : ' + adminid);
    
    db.transaction(trx =>{
        trx.insert({
            name:name,
            administrator:adminid,
            createdon:new Date()
        })
        .into('clouds')
        .returning('id')
        .then(id =>{
            return trx('memberships')
            .returning('groupid')
            .insert({
                groupid:id[0],
                userid:adminid,
        })
            .then(id=> {
                if(Array.isArray(id)){
                    res.json({
                        created:true,
                        id:id[0]
                    })
                }else{
                    res.json({
                        created:false,
                        id:0
                    }) 
                }
            })
        })
        .then(trx.commit)
        .catch(trx.rollback)
    })
    .then()
    
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

// get 'PUT' signed URL FROM AWS ----------------------------------------------------------------

app.post ('/putobject_signedurl',(req,res) =>{

    console.log('put_signedurl', req.body);

    const s3 = new aws.S3(); // Create a new instance of S3
    const fileName = req.body.fileName;
    const fileType = req.body.fileType;

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
            
            res.json( {
                success:true,
                data: {
                    signedRequest: signedURL,
                    url: `https://${S3_BUCKET}.s3.amazonaws.com/${fileName}`
                }
             }) 
             
        }
    });

})


// get 'GET' signed URL FROM AWS ----------------------------------------------------------------

app.post ('/getObject_signedurl',(req,res) =>{

    console.log('getObject_signedurl', req.body);

    const s3 = new aws.S3(); 
    const fileName = req.body.fileName;
   
    const s3Params = {
        Bucket: S3_BUCKET,
        Key: fileName,
        Expires: 604800,
    };
    
    s3.getSignedUrl('getObject', s3Params, (err, signedURL) => {
        if (err) {
            console.log('getobject_signedurl Err : ',err);
            res.json({ success: false, error: err });
        }else{
            res.json( {
                success:true,
                data:signedURL,
                error:null
             }) 
             
        }
    });

})

// create memory --------------------------------------------------

app.post('/creatememory',(req,res) => {
    const {userid,title,story,description,location} = req.body
    console.log('creatememory : title ' + title + ' userid ' + userid );
    
    db('memories')
        .returning('memid')
        .insert({
            createdon:new Date(),
            userid:userid,
            title:title,
            description:description,
            location:location,
            cardtype:0,
            story:story          
        }).then(result =>{
            console.log('creatememory result ' + result + ' json result ' + JSON.stringify(result));
            res.json( {
                success:true,
                data:result,
                error:null
             }) 
        }).catch(err =>{
            console.log('creatememory error ' + err + ' json error ' + JSON.stringify(err));
            res.json( {
                success:false,
                data:null,
                error:err
            })}  
        )
})

// Add file to memory ---------

app.post('/associateFile',(req,res) => {
    const{memid,fileurl,fileext,thumburl,thumbext,ishero} = req.body;
    

    db('memfiles').returning('*')
        .insert({
            memid:memid,
            fileurl:fileurl,
            fileext:fileext,
            thumburl:thumburl,
            thumbext:thumbext,
            ishero:ishero
        })
        .then(result =>{
            res.json( {
                success:true,
                data:result,
                error:null
             }) 
        }).catch(err =>{
            res.json( {
                success:true,
                data:err,
                error:null
            })
        })
    })  

// Associate key words with a memory ----------------------------------------------------------------

app.post('/associateKeyword',(req,res) => {
    const {memid,keyword} = req.body
    
    db('memwords')
        .returning('memid')
        .insert({
            memid:memid,
            keyword:keyword
    })
        .then(result=> {
            res.json(result[0]);  // returns the memory id if successfull
        })
        .catch(err=> res.status(400).json('unable to associate'))
})

// -------------------------------------------------------------------------------------------

app.post('/removeTaggedPerson',(req,res) => {
    const {memid,userid} = req.body

    console.log('removeTaggedPerson : memoryid , userid ' + memid + ', ' + userid);
    
    db('mempeople')
        .where('memid',memid).andWhere('userid',userid)
        .returning('*')
        .del()
        .then(result=> {
            res.json({
                success:true,
                data:null,
                error:null
            })
        })
        .catch(err=> {
            res.json({
                success:true,
                data:null,
                error:null
            })
        })
})

// -------------------------------------------------------------------------------------------

app.post('/delete_user',(req,res) => {
    const {userid} = req.body

    console.log('delete_user : userid ' + userid);
    
    db('users')
        .where('userid',userid)
        .del()
        .then(result=> {
            res.json({
                success:true,
                data:null,
                error:null
            })
        })
        .catch(err=> {
            res.json({
                success:false,
                data:null,
                error:null
            })
        })
})


// -------------------------------------------------------------------------------------------

app.post('/removeCloudFromMemory',(req,res) => {
    const {memid,cloudid} = req.body

    console.log('removeCloudFromMemory : memoryid : ' +  memid + ' cloudid :' + cloudid)
    
    db('memgroups')
        .where('memid',memid).andWhere('groupid',cloudid)
        .returning('*')
        .del()
        .then(result=> {
            res.json({
                success:true,
                data:null,
                error:null
            })
        })
        .catch(err=> {
            res.json({
                success:true,
                data:null,
                error:null
            })
        })
})

// -------------------------------------------------------------------------------------------

app.post('/removeFileFromMemory_fileurl',(req,res) => {
    const {memid,fileurl} = req.body
    const s3 = new aws.S3();
  
    console.log('removeFileFromMemory_fileurl : memoryid : ' +  memid + ' fileurl :' + fileurl)

    strarray = fileurl.split('/')            
    keyname = strarray[strarray.length-1]
    console.log('removeFileFromMemory_fileurl : keyname ' + keyname);
    var deleteParam = {
        Bucket: S3_BUCKET,
        Key:keyname
    }
    console.log('removeFileFromMemory_fileurl : deleteparam : ' + JSON.stringify(deleteParam))
    
    s3.deleteObject(deleteParam, function(err, data) {
        if (err) {
            console.log('removeFileFromMemory_fileurl : err ' + err,)
        }else{

            db('memfiles')
            .where('memid',memid).andWhere('fileurl',fileurl)
            .returning('*')
            .del()
            .then(result=> {
                res.json({
                    success:true,
                    data:result,
                    error:null
                })
            })
            .catch(err=> {
                res.json({
                    success:true,
                    data:null,
                    error:err
                })
            })
        }
    })
})

// -------------------------------------------------------------------------------------

app.post('/set_user_memberships',(req,res) =>{

    const {userid,cloudids} = req.body
    let memberships=[]
    console.log('set_user_clouds req with body :' + userid + ' : ' + JSON.stringify(cloudids)) 
    db.transaction(trx=>{
        trx('memberships').where('userid',userid).del()
        .then(response =>{
            cloudids.map(cloudid =>{memberships.push({userid:userid,groupid:cloudid})})
            return trx('memberships').insert(memberships)
        })
        .then(trx.commit)
        .then((result)=>{
            res.json({
                success:true,
                data:null,
                error:null
                })
            })
        .catch(trx.rollback).then(err =>{
            res.json({
                success:false,
                data:null,
                error:err
                })
        })
    })
              
    
})

// -------------------------------------------------------------------------------------

app.post('/setHeroImage_fileurl',(req,res) => {
    const {memid,fileurl} = req.body
    console.log('setHeroImage_fileurl : memoryid : ' +  memid + ' fileurl :' + fileurl)
    
    db.transaction(trx =>{
        trx('memfiles').where('memid',memid).update({ishero:false})   
    .then(() => {        
        return trx('memfiles')
            .where('memid',memid).andWhere('fileurl',fileurl)
            .update({ishero:true})
            .returning('*')
        })
        .then(trx.commit) 
        .then(result=> {
                res.json({
                    success:true,
                    data:result,
                    error:null
                })
            })
        .catch(err=> {
            res.json({
                success:true,
                data:null,
                error:err
            })
        })
    })
    
})


// Associate a userID with a memory ----------------------------------------------------------------

app.post('/associatePerson',(req,res) => {
    const {memid,userid} = req.body

    console.log('associatePerson : memoryid , userid ' + memid + ', ' + userid);
    
    db('mempeople')
        .returning('memid')
        .insert({
            memid:memid,
            userid:userid
    })
        .then(result=> {
            res.json({
                success:true,
                data:result[0],
                error:null
                }) // returns the memory id if successfull
        })
        .catch(err=> res.json({
            success:false,
            data:null,
            error:err
            })
        )
})

// Associate a groupID with a memory ----------------------------------------------------------------

app.post('/associateGroup',(req,res) => {
    const {memid,groupid} = req.body
    console.log('associateCloud : memid ' + memid + ' : cloudid ' + groupid);

    db('memgroups')
        .returning('memid')
        .insert({
            memid:memid,
            groupid:groupid
    })
        .then(result=> {            
            res.json({
                success:true,
                data:result[0],
                error:null
                })
        })
        .catch(err=> res.json({
            success:true,
            data:result[0],
            error:null
            })
        )
})

// profile/id ----------------------------------------------------------------

app.post('/getUser_userid',(req,res) =>{

    const { userid } = req.body;
    console.log('getUser : ' + userid);
        
    db.select('*').from('users').where({userid:userid}).then(users=>{
        if(Array.isArray(users)){
            console.log('get_User returned : userid: ' + users[0].userid + ' ' + users[0].firstname + ' ' + users[0].lastname )
            
            res.json({
                success:true,
                data:users[0],
                error:null
                })
            
        }else{
            console.log('get_User returned : userid: ' + userid + ' not found ! ' )
            res.json({
                success:false,
                data:null,
                error:'User not found'
                })
        }
    })
    .catch(err=> {
        console.log('get_User returned : userid: ' + userid + ' ' + err )
        res.json({
            success:false,
            data:null,
            error:err
            })
    })    
})

//------------------------------------------------------------------------------------------------------

app.post('/get_cloud_memberships',(req,res) =>{

    
    console.log('get_cloud_memberships')
        
    db.select('memberships.userid', 'clouds.id','clouds.name','clouds.logo')
    .from('memberships')
    .join('clouds', function() {this.on('clouds.id', '=', 'memberships.groupid')})
    .orderBy('memberships.userid')
    .then(memberships=>{
        if(Array.isArray(memberships)){
            console.log('get_cloud_memberships returned : ' + JSON.stringify(memberships))
            
            res.json({
                success:true,
                data:memberships,
                error:null
                })
            
        }else{
            console.log('get_cloud_memberships returned : not an array' )
            res.json({
                success:false,
                data:null,
                error:'User not found'
                })
        }
    })
    .catch(err=> {
        console.log('get_cloud_memberships returned  ' + err )
        res.json({
            success:false,
            data:null,
            error:err
            })
    })    
})


//------------------------------------------------------------------------------------------------------

app.post('/get_memories_userid_keywords_cloudids',(req,res) =>{

    const {words,userid,cloudids} = req.body
    console.log('get_memories_userid_keywords_cloudids : userid : ' + userid + ' words ' + words + ' cloud ids ' + cloudids);
    
    
    db.select('*')                
    .from('memories')
    .where({userid:userid})
    .andWhere(function(){
        this.whereIn('memories.memid',function(){
            this.select('memwords.memid').from('memwords').whereIn('keyword',words)})})

    .orWhereIn('memories.memid',function(){this.select('memgroups.memid').from('memgroups')
            .whereIn('memgroups.groupid',cloudids)})
            .andWhere(function(){
                this.whereIn('memories.memid',function(){
                    this.select('memwords.memid').from('memwords').whereIn('keyword',words)})})
    
    .orderBy('memories.createdon','desc')
            

    .then(memories=>{
       
        if(Array.isArray(memories)){
            console.log('get_memories_userid_keywords_cloudids : success = ' + true);
            memories.map((mem,index) =>{console.log('returned memory : ' + index + ' memid' + mem.memid + ' Title ' + mem.title )})
            
            res.json({
                success:true,
                data:memories,
                error:null
                })
            
        }else{
            res.json({
                success:false,
                data:null,
                error:'No memories found'
                })
        }
    })
    .catch(err=> {
        console.log('get_memories_userid_keywords_cloudids : err : ' + err) 
        res.json({
            success:false,
            data:null,
            error:err
            })  
    })
})

//------------------------------------------------------------------------------------------------------

app.post('/get_memories_keywords_user_allclouds',(req,res) =>{

    const {words,userid} = req.body
    console.log('get_memories_keywords_user_allclouds : userid : ' + userid + ' words ' + words);
    
    
    db.select('*')
    .from('memories')
    .join('memfiles', function() {this.on('memfiles.memid', '=', 'memories.memid').onIn('memfiles.ishero',[true])})
    .where({userid:userid})
    .andWhere(function(){
        this.whereIn('memories.memid',function(){
            this.select('memwords.memid').from('memwords').whereIn('keyword',words)})})

    .orWhereIn('memories.memid',function(){this.select('memgroups.memid').from('memgroups')
            .whereIn('memgroups.groupid',function(){this.select('memberships.groupid').from('memberships').where({userid:userid})})})
            .andWhere(function(){
                this.whereIn('memories.memid',function(){
                    this.select('memwords.memid').from('memwords').whereIn('keyword',words)})})
    
    .orderBy('memories.createdon','desc')

    .then(memories=>{
        if(Array.isArray(memories)){
            console.log('get_memories_keywords_user_allclouds : success = ' + true);
            memories.map((mem,index) =>{console.log('returned memory : ' + index + ' memid' + mem.memid + ' Title ' + mem.title )})
            res.json({
                success:true,
                data:memories,
                error:null
                })
            
        }else{
            res.json({
                success:false,
                data:null,
                error:'No memories found'
                })
        }
    })
    .catch(err=> {
        console.log('get_memories_keywords_user : err : ' + err) 
        res.json({
            success:false,
            data:null,
            error:err
            })  
    })
})

//------------------------------------------------------------------------------------------------------

app.post('/get_memories_keywords_clouds',(req,res) =>{

    const {words,cloudids} = req.body
    console.log('get_memories_keywords_clouds : cloudids : ' + cloudids + ' words ' + words);
    
    
    db.select('*')
    .from('memories')
    .join('memfiles', function() {this.on('memfiles.memid', '=', 'memories.memid').onIn('memfiles.ishero',[true])})
    .where(function(){
        this.whereIn('memories.memid',function(){
            this.select('memwords.memid').from('memwords').whereIn('keyword',words)})})

    .andWhere(function(){
        this.whereIn('memories.memid',function(){this.select('memid').from('memgroups')
        .whereIn('memgroups.groupid',cloudids)})})
    
    .orderBy('memories.createdon','desc')

    .then(memories=>{
        if(Array.isArray(memories)){
            console.log('get_memories_keywords_clouds : success = ' + true);
            memories.map((mem,index) =>{console.log('returned memory : ' + index + ' memid' + mem.memid + ' Title ' + mem.title )})
            res.json({
                success:true,
                data:memories,
                error:null
                })
            
        }else{
            res.json({
                success:false,
                data:null,
                error:'No memories found'
                })
        }
    })
    .catch(err=> {
        console.log('get_memories_keywords_clouds : err : ' + err) 
        res.json({
            success:false,
            data:null,
            error:err
            })  
    })
})

// search user ----------------------------------------------------------------

app.post('/get_memories_userid_allclouds',(req,res) =>{

    const {userid} = req.body
    console.log('get_memories_userid_allclouds : userid : ' + userid );

    db.select('*')
    .from('memories')
    .join('memfiles', function() {this.on('memfiles.memid', '=', 'memories.memid').onIn('memfiles.ishero',[true])})
    .where({userid:userid})
    .orWhereIn('memories.memid',function(){this.select('memid').from('memgroups')
        .whereIn('memgroups.groupid',function(){this.select('groupid').from('memberships')
            .where({userid:userid})})})

    .orderBy('memories.createdon','desc')

    .then(memories=>{
        
        if(Array.isArray(memories)){
            console.log('get_memories_userid_allclouds : success = ' + true);
            memories.map((mem,index) =>{console.log('returned memory : ' + index + ' memid' + mem.memid + ' Title ' + mem.title )})
            res.json({
                success:true,
                data:memories,
                error:null
                })
            
        }else{
            res.json({
                success:false,
                data:null,
                error:'No memories found'
                })
        }
    }).catch(err=> res.json({
                success:false,
                data:null,
                error:err
                })
            )
})

//------------------------------------------------------------------------------------------------------

app.post('/get_memories_keywords_user_noclouds',(req,res) =>{

    const {words,userid} = req.body
    console.log('get_memories_keywords_user_noclouds : userid : ' + userid + ' words ' + words);
    
    
    db.select('*')
    .from('memories')
    .join('memfiles', function() {this.on('memfiles.memid', '=', 'memories.memid').onIn('memfiles.ishero',[true])})
    .where({userid:userid})
    .andWhere(function(){
        this.whereIn('memories.memid',function(){
            this.select('memwords.memid').from('memwords').whereIn('keyword',words)})})
    
    .orderBy('memories.createdon','desc')

    .then(memories=>{
        if(Array.isArray(memories)){
            console.log('get_memories_keywords_user_noclouds : success = ' + true);
            memories.map((mem,index) =>{console.log('returned memory : ' + index + ' memid' + mem.memid + ' Title ' + mem.title )})
            res.json({
                success:true,
                data:memories,
                error:null
                })
            
        }else{
            res.json({
                success:false,
                data:null,
                error:'No memories found'
                })
        }
    })
    .catch(err=> {
        console.log('get_memories_keywords_user_noclouds : err : ' + err) 
        res.json({
            success:false,
            data:null,
            error:err
            })  
    })
})

// ------------------------------------------------------------------

app.post('/get_memories_userid_noclouds',(req,res) =>{

    const {userid} = req.body
    console.log('get_memories_userid_noclouds : userid : ' + userid );
    
    db.select('*')
    .from('memories')
    .join('memfiles', function() {this.on('memfiles.memid', '=', 'memories.memid').onIn('memfiles.ishero',[true])})
    .where({userid:userid})
    .orderBy('memories.createdon','desc')

    .then(memories=>{
        
        if(Array.isArray(memories)){
            console.log('get_memories_userid_noclouds : success = ' + true);
            memories.map((mem,index) =>{console.log('returned memory : ' + index + ' memid' + mem.memid + ' Title ' + mem.title )})
            res.json({
                success:true,
                data:memories,
                error:null
                })
            
        }else{
            res.json({
                success:false,
                data:null,
                error:'No memories found'
                })
        }
    }).catch(err=> res.json({
                success:false,
                data:null,
                error:err
                })
            )
})

// ------------------------------------------------------------------

app.post('/get_memories_userid_noclouds_unshared',(req,res) =>{

    const {userid} = req.body
    console.log('get_memories_userid_noclouds_unshared : userid : ' + userid );

    db.select('*')
    .from('memories')
    .join('memfiles', function() {this.on('memfiles.memid', '=', 'memories.memid').onIn('memfiles.ishero',[true])})
    .where({userid:userid})
    .andWhereNot('memories.memid',function(){this.select('memid').from('memgroups')
        .whereIn('memgroups.groupid',function(){this.select('groupid').from('memberships')
            .where({userid:userid})})})
    
    .orderBy('memories.createdon','desc')

    .then(memories=>{
        
        if(Array.isArray(memories)){
            console.log('get_memories_userid_noclouds_unshared : success = ' + true);
            memories.map((mem,index) =>{console.log('returned memory : ' + index + ' memid' + mem.memid + ' Title ' + mem.title )})
            res.json({
                success:true,
                data:memories,
                error:null
                })
            
        }else{
            res.json({
                success:false,
                data:null,
                error:'No memories found'
                })
        }
    }).catch(err=> res.json({
                success:false,
                data:null,
                error:err
                })
            )
})

// ------------------------------------------------------------------

app.post('/get_memories_userid_keywords_noclouds_unshared',(req,res) =>{

    const {userid} = req.body
    console.log('get_memories_userid_keywords_noclouds_unshared : userid : ' + userid );

    db.select('*')
    .from('memories')
    .join('memfiles', function() {this.on('memfiles.memid', '=', 'memories.memid').onIn('memfiles.ishero',[true])})
    .where({userid:userid})
    .andWhereNot('memories.memid',function(){this.select('memid').from('memgroups')
        .whereIn('memgroups.groupid',function(){this.select('groupid').from('memberships').where({userid:userid})})})
    .andWhere(function(){
        this.whereIn('memories.memid',function(){
            this.select('memwords.memid').from('memwords').whereIn('keyword',words)})})
    .orderBy('memories.createdon','desc')

    .then(memories=>{
        
        if(Array.isArray(memories)){
            console.log('get_memories_userid_keywords_noclouds_unshared : success = ' + true);
            memories.map((mem,index) =>{console.log('returned memory : ' + index + ' memid' + mem.memid + ' Title ' + mem.title )})
            res.json({
                success:true,
                data:memories,
                error:null
                })
            
        }else{
            res.json({
                success:false,
                data:null,
                error:'No memories found'
                })
        }
    }).catch(err=> res.json({
                success:false,
                data:null,
                error:err
                })
            )
})

// search user ----------------------------------------------------------------

app.post('/get_memories_userid_cloudids',(req,res) =>{

    const {userid,cloudids} = req.body
    console.log('get_memories_userid_cloudids : userid : ' + userid + ' cloudids : ' + cloudids);
    
    db.select('*')
    .from('memories')
    .where({userid:userid})
    .orWhere(function(){
        this.whereIn('memories.memid',function(){this.select('memid').from('memgroups')
        .whereIn('memgroups.groupid',cloudids)})})

    .orderBy('memories.createdon','desc')
    .then(memories=>{
        
        if(Array.isArray(memories)){
            console.log('get_memories_userid_cloudids : success = ' + true);
            memories.map((mem,index) =>{console.log('returned memory : ' + index + ' memidid ' + mem.memid + ' Title ' + mem.title )})
            res.json({
                success:true,
                data:memories,
                error:null
                })
            
        }else{
            res.json({
                success:false,
                data:null,
                error:'No memories found'
                })
        }
    }).catch(err=> res.json({
                success:false,
                data:null,
                error:err
                })
            )
})

// ----------------------------------------------------------------

app.post('/get_memories_cloudids',(req,res) =>{

    const {cloudids} = req.body
    console.log('get_memories_cloudids : cloudids : ' + cloudids);
    
    db.select('*')
    .from('memories')
    .where(function(){this.whereIn('memories.memid',function(){this.select('memid').from('memgroups')
        .whereIn('memgroups.groupid',cloudids)})})

    .orderBy('memories.createdon','desc')
    .then(memories=>{
        
        if(Array.isArray(memories)){
            console.log('get_memories_cloudids : success = ' + true);
            memories.map((mem,index) =>{console.log('returned memory : memidid ' + mem.memid + ' Title ' + mem.title )})
            res.json({
                success:true,
                data:memories,
                error:null
                })
            
        }else{
            res.json({
                success:false,
                data:null,
                error:'No memories found'
                })
        }
    }).catch(err=> res.json({
                success:false,
                data:null,
                error:err
                })
            )
})

// --------------------------------------------------------------------------------

app.post('/get_memories_cloudids_keywords',(req,res) =>{

    const {cloudids,words} = req.body
    console.log('get_memories_cloudids_keywords : cloudids : ' + cloudids + ' words ' + words);
    
    db.select('*')
    .from('memories')
    .where(function(){this.whereIn('memories.memid',function(){this.select('memid').from('memgroups')
        .whereIn('memgroups.groupid',cloudids)})})

    .andWhere(function(){
        this.whereIn('memories.memid',function(){
            this.select('memwords.memid').from('memwords').whereIn('keyword',words)})})    

    .orderBy('memories.createdon','desc')
    .then(memories=>{
        
        if(Array.isArray(memories)){
            console.log('get_memories_cloudids_keywords : success = ' + true);
            memories.map((mem,index) =>{console.log('returned memory : memidid ' + mem.memid + ' Title ' + mem.title )})
            res.json({
                success:true,
                data:memories,
                error:null
                })
            
        }else{
            res.json({
                success:false,
                data:null,
                error:'No memories found'
                })
        }
    }).catch(err=> res.json({
                success:false,
                data:null,
                error:err
                })
            )
})

// --------------------------------------------------------------------------------



app.post('/set_searchwords_memid',(req,res)=>{
    const {memid,searchwords } = req.body
    addarray = []
    console.log('set_searchwords_memid for memid ' + memid + ' searchWord count : ' + searchwords.length);
    
    db.transaction(trx =>{
        trx('memwords').where({memid:memid}).del()
        .then(() =>{
           searchwords.map(worditem =>{
            console.log('set_searchwords_memid : worditem' + JSON.stringify(worditem));
               
                addarray.push(
                {
                   memid:memid,
                   keyword:worditem.keyword,
                   strength:worditem.strength 
                })
               
           })
           console.log('set_searchwords_memid : addarray' + JSON.stringify(addarray));
           
           return trx('memwords').insert(addarray)
        })
        .then(trx.commit)
        .then(()=>{
            console.log('set_searchwords_memid : commit = ' + true);
            res.json({
                success:true,
                data:null,
                error:null
                })
            })
        .catch(trx.rollback).then(err =>{
            console.log('set_searchwords_memid : commit = ' + false);
            console.log('set_searchwords_memid : error = ' + JSON.stringify(err));
            res.json({
                success:false,
                data:null,
                error:JSON.stringify(err)
                })
    })
})
})
// --------------------------------------------------------------------------------


app.post('/get_searchwords_memid',(req,res) =>{

    const {memid} = req.body
    console.log('get_searchwords_memid : memid ' + memid )

    db.select('*')
    .from('memwords')
    .where({memid:memid}) 
    .orderBy('strength','desc')

    .then(words=>{
        if(Array.isArray(words)){
            console.log('get_searchwords_memid succesfull = ' + true)
            res.json({
                success:true,
                data:words,
                error:null
            })
        }else{
            console.log('get_searchwords_memid succesfull = ' + false)
            res.json({
                success:false,
                data:null,
                error:null
            })
        }
    }).catch(err=> {
        console.log('get_searchwords_memid error = ' + err)
            res.json({
                success:false,
                data:null,
                error:err
            })
    })
})

//----------------------------------------------------------------------------

app.post('/get_clouds',(req,res) =>{

    console.log('get_clouds_: query eceived');
    
    db.select('*')
    .from('clouds')
    .orderBy('name')
    .then(clouds=>{
        console.log('get_clouds : db returned clouds : ' + clouds);
        if(Array.isArray(clouds)){
            res.json({
                success:true,
                data:clouds,
                error:null
            })
        }else{
            res.json({
                success:false,
                data:null,
                error:'Query executed but failed to return results'
            })
        }
    }).catch(err=> {
        console.log('get_clouds db returned  : ' + err)
        res.json({
            success:false,
            data:null,
            error:err
        })
    })
})

//----------------------------------------------------------------------------

app.post('/get_clouds_userid',(req,res) =>{

    const {userID} = req.body
    console.log('get_clouds_userid : received query for user ' + userID);
    
    
    db.select('*')
    .from('clouds')
    .whereIn('clouds.id',function(){
        this.select('groupid').from('memberships').where({userid:userID})})
    .orderBy('clouds.createdon','desc')
    .then(clouds=>{
        console.log('get_clouds_userid : db returned clouds : ' + clouds);
        if(Array.isArray(clouds)){
            res.json({
                success:true,
                data:clouds,
                error:null
            })
        }else{
            res.json({
                success:false,
                data:null,
                error:'Query executed but failed to return results'
            })
        }
    }).catch(err=> {
        console.log('get_clouds_userid db returned  : ' + err)
        res.json({
            success:false,
            data:null,
            error:err
        })
    })
})

// -------------------------------------------------------------------------------------

app.post('/get_memfiles_memoryid',(req,res) =>{

    const {memoryid} = req.body
    console.log('get_memfiles_memoryid req with body :' + memoryid);
    
    db.select('*')
    .from('memfiles')
    .where({memid:memoryid})
    .orderBy('ishero','desc')
    .then(memoryFiles=>{
        
        if(Array.isArray(memoryFiles)){
            
            memoryFiles.map((mf,index) => {
                    console.log('memfile file  : ' + JSON.stringify(mf.fileurl))
                    console.log('memfile thumb : ' + JSON.stringify(mf.thumburl))
                })
            
            res.json({
                success:true,
                data:memoryFiles,
                error:null
            })
            console.log('db res : ' + res);
          
        }else{
            console.log('db memfiles is not an array ');
            res.json({
                success:false,
                data:null,
                error:'db returned empty result'
            })
        }
    }).catch(err=> {
        console.log('db exception : ' + err)
        res.json({
            success:false,
            data:null,
            error:err
        })
      
    })
})

// -------------------------------------------------------------------------------------

app.post('/get_associatedpeople_memoryid',(req,res) =>{

    const {memoryid} = req.body
    console.log('get_associatedpeople_memoryid req with body :' + memoryid);
    
    db.select('mempeople.userid', 'users.firstname', 'users.lastname')
    .from('mempeople').join('users', function() {
        this.on('users.userid', '=', 'mempeople.userid')})
    .where({memid:memoryid})
    .then(people=>{
        console.log('db returned : ' + JSON.stringify(people))
        
        if(Array.isArray(people)){
            console.log('db people is an array :' + JSON.stringify(people));
            res.json({
                success:true,
                data:people,
                error:null
            })
          
        }else{
            console.log('db people is not an array ');
            res.json({
                success:false,
                data:null,
                error:'db returned empty result'
            })
        }
    }).catch(err=> {
        console.log('db exception : ' + err)
        res.json({
            success:false,
            data:null,
            error:err
        })
      
    })
})

// -------------------------------------------------------------------------------------

app.post('/get_associatedclouds_memoryid',(req,res) =>{

    const {memoryid} = req.body
    console.log('get_associatedclouds_memoryid req with body :' + memoryid);
    
    db.select('clouds.id', 'clouds.name')
    .from('clouds')
    .whereIn('clouds.id',function(){
        this.select('groupid').from('memgroups').where({memid:memoryid})})
    .then(clouds=>{
        console.log('get_associatedclouds_memoryid returned : ' + JSON.stringify(clouds))
        
        if(Array.isArray(clouds)){
            console.log('get_associatedclouds_memoryid clouds is an array :' + JSON.stringify(clouds));
            res.json({
                success:true,
                data:clouds,
                error:null
            })
          
        }else{ 
            console.log('get_associatedclouds_memoryid clouds is not an array ');
            res.json({
                success:false,
                data:null,
                error:'get_associatedclouds_memoryid returned empty result'
            })
        }
    }).catch(err=> {
        console.log('get_associatedclouds_memoryid exception : ' + err)
        res.json({
            success:false,
            data:null, 
            error:err
        })
    })
    
})

// -------------------------------------------------------------------------------------

app.post('/get_cloud_people_userid',(req,res) =>{

    const {userid} = req.body

    
    db.select('*').from('users').whereIn('user.userid', function(){
        this.select('userid').from('memberships').whereIn('groupid',function(){
            this.select('groupid').from('memberships').where({userid:userid})
        })
    })
    .then(people=>{
       
        if(Array.isArray(people)){
            console.log('get_cloud_people_userid return userids : ' + people.map(p=>{return parseInt(p.userid)}));
            res.json({
                success:true,
                data:people,
                error:null
            })
          
        }else{ 
            console.log('get_cloud_people_userid clouds is not an array ');
            res.json({
                success:false,
                data:null,
                error:'get_cloud_people_userid returned empty result'
            })
        }
    }).catch(err=> {
        console.log('get_cloud_people_userid exception : ' + err)
        res.json({
            success:false,
            data:null, 
            error:err
        })
    })


})

// -------------------------------------------------------------------------------------


app.post('/get_user_by_email',(req,res) =>{

    const {email} = req.body

    console.log('get_user_by_email ' + email)
    
    db.select('*')
    .from('users')
    .where({email:email})
    .then(people=>{
        if(people.length > 0){            
            console.log('get_user_by_email returned : ' + JSON.stringify(people) )
            res.json({
                success:true,
                data:people[0],
                error:null
            })
          
        }else{ 
            console.log('get_user_by_email : user with this email does not exist ');
            res.json({
                success:false,
                data:null,
                error:'get_user_by_email returned empty result'
            })
        }
    }).catch(err=> {
        console.log('get_user_by_email exception : ' + err)
        res.json({
            success:false,
            data:null, 
            error:err
        })
    })
})

// -------------------------------------------------------------------------------------

app.post('/get_all_users',(req,res) =>{

    console.log('get_all_users ')
    
    db.select('*')
    .from('users')
    .then(people=>{
        if(Array.isArray(people)){            
            console.log('get_all_users returned : '  )
            res.json({
                success:true,
                data:people,
                error:null
            })
          
        }else{ 
            console.log('get_all_users clouds is not an array ');
            res.json({
                success:false,
                data:null,
                error:'get_all_users returned empty result'
            })
        }
    }).catch(err=> {
        console.log('get_all_users exception : ' + err)
        res.json({
            success:false,
            data:null, 
            error:err
        })
    })
})


// -------------------------------------------------------------------------------------

app.post('/get_cloud_people_clouds',(req,res) =>{

    const cloudIDs = []
    const {clouds} = req.body
    clouds.map(cloud =>{cloudIDs.push(cloud.id)})
    
    db.select('*').from('users').whereIn('users.userid', function(){
        this.select('userid').from('memberships').whereIn('groupid',cloudIDs)})
    .then(people=>{
        
        if(Array.isArray(people)){
            console.log('get_cloud_people_clouds returned userids : ' + people.map(p => {return p.userid}))
            res.json({
                success:true,
                data:people,
                error:null
            })
          
        }else{ 
            console.log('get_cloud_people_clouds clouds is not an array ');
            res.json({
                success:false,
                data:null,
                error:'get_cloud_people_clouds returned empty result'
            })
        }
    }).catch(err=> {
        console.log('get_cloud_people_userid exception : ' + err)
        res.json({
            success:false,
            data:null, 
            error:err
        })
    })
})


// -------------------------------------------------------------------------------------

app.post('/delete_memory',(req,res) =>{

const {memoryid} = req.body
console.log('delete_memory called for memid : ' + memoryid);

deleteS3MemoryFiles(memoryid)

db.transaction(trx =>{
    trx('memfiles').where('memid',memoryid).del().returning('memid')                 
    .then(response =>{
        console.log('delete_memory : delete memfiles : ' + memoryid);
        return trx('memgroups').where('memid',memoryid).del().returning('memid')
    })
    .then(response =>{
        console.log('delete_memory : delete mempeople : ' + memoryid);
        return trx('mempeople').where('memid',memoryid).del().returning('memid')
    })
    .then(response =>{
        console.log('delete_memory : delete memwords : ' + memoryid);
        return trx('memwords').where('memid',memoryid).del().returning('memid')
    })
    .then(response =>{
        console.log('delete_memory : delete memories : ' + memoryid);
        return trx('memories').where('memid',memoryid).del().returning('memid')
    })
    .then(trx.commit).then(()=>{
        res.json({
            success:true,
            data:null,
            error:null
            })
        })
    
    .catch(trx.rollback).then(err =>{
        res.json({
            success:false,
            data:null,
            error:err
            })
    })
})
     
    
})

// -------------------------------------------------------------------------------------

deleteS3MemoryFiles = (memid) => {

    console.log('deleteS3MemoryFiles for memid : ' + memid);
    const s3 = new aws.S3();
    let objects = []
    db.select('*')
    .from('memfiles')
    .where({memid:memid})
    .then(memoryFiles=>{
        console.log('deleteS3MemoryFiles : select memfiles for memid: ' + memid + ' returned : ' + memoryFiles.length + ' memfiles')
        
        if(Array.isArray(memoryFiles) && memoryFiles.length){
    
            memoryFiles.map(file => {
                
                strarray = file.fileurl.split('/')            
                keyname = strarray[strarray.length-1]
                objects.push({Key:keyname})

                strarray = file.thumburl.split('/')            
                keyname = strarray[strarray.length-1]
                objects.push({Key:keyname})

                })
        
            var deleteParam = {
                Bucket: S3_BUCKET,
                Delete: {
                    Objects:objects
                }
            }
    
            s3.deleteObjects(deleteParam, function(err, data){
                if (err) {
                    console.log('deleteS3MemoryFiles : error deleting from S3 : ' + err)
                }else{
                    console.log('deleteS3MemoryFiles : delete from S3 successfull')
                    deleteParam.Delete.Objects.map(obj => {
                        console.log('s3-delete : ' + obj.Key);
                    })
                }
            })
        }else{
            console.log('deleteS3MemoryFiles : ERROR : memFiles returned empty for memid : ' + memid );
        }
    })    
}

// -------------------------------------------------------------------------------------

app.post('/set_memory_cardtype',(req,res) =>{
    const {memoryid,cardtype} = req.body
    console.log('set_memory_cardtype req with body :' + memoryid + ' : ' + cardtype) 
    
    db('memories')
    .where({memid:memoryid})
    .update({cardtype:cardtype})
    .catch(err=> {
        console.log('set_memory_cardtype db exception : ' + err)
        res.json({
            success:false,
            data:null,
            error:err
        })
    })
    console.log('set_memory_cardtype db update success : ' + true)
    res.json({
        success:true,
        data:null,
        error:null
    })

})


// -------------------------------------------------------------------------------------

app.post('/set_searchword',(req,res) =>{

    const {id,memid,keyword,strength,included} = req.body
    console.log('set_searchword req with body :' + id + ' : ' + keyword + ':' + strength + ':' + included) 
    
    db('memwords')
    .where({id:id})
    .update({memid:memid,keyword:keyword,strength:strength,included:included})
    .catch(err=> {
        console.log('db exception : ' + err)
        res.json({
            success:false,
            data:null,
            error:err
        })
    })
    console.log('db update success : ' + true)
    res.json({
        success:true,
        data:null,
        error:null})
})

// -------------------------------------------------------------------------------------

app.post('/set_memory_title',(req,res) =>{

    const {memoryid,newTitle} = req.body
    console.log('set_memory_title req with body :' + memoryid + ' : ' + newTitle) 
    
    db('memories')
    .where({memid:memoryid})
    .update({title:newTitle})
    .catch(err=> {
        console.log('db exception : ' + err)
        res.json({
            success:false,
            data:null,
            error:err
        })
    })
    console.log('db update success : ' + true)
    res.json({
        success:true,
        data:null,
        error:null})
})

// -------------------------------------------------------------------------------------

app.post('/set_memory_tagged_people',(req,res) =>{

    const {memoryid,taggedPeople} = req.body
    addarray = []
    console.log('set_memory_tagged_people req with body :' + memoryid + ' : ' + JSON.stringify(taggedPeople)) 
    
    db.transaction(trx =>{
        trx('mempeople').where('memid',memoryid).del().returning('memid')                 
        .then(response =>{
            console.log('set_memory_tagged_people : delete mempeople for memory : ' + JSON.stringify(response.memid));
            
                taggedPeople.map(person =>{
                    console.log('set_memory_tagged_people : insert into mempeople memid,userid : ' + memoryid + ', ' + person.userid);
                    addarray.push(
                        {
                            'memid' : memoryid,
                            'userid': person.userid
                        }
                    )
                })
                console.log('set_memory_tagged_people : addarray ' + JSON.stringify(addarray));
                
                return trx('mempeople').insert(addarray).returning('*')
          
        })
        .then(trx.commit)
        .then(()=>{
            res.json({
                success:true,
                data:null,
                error:null
                })
            })
        .catch(trx.rollback).then(err =>{
            res.json({
                success:false,
                data:null,
                error:err
                })
    })
})
})

// -------------------------------------------------------------------------------------

app.post('/set_memory_clouds',(req,res) =>{

    const {memoryid,clouds} = req.body
    console.log('set_memory_clouds req with body :' + memoryid + ' : ' + clouds) 
    
    db.transaction(trx =>{
        trx('memgroups').where('memid',memoryid).del().returning('memid')                 
        .then(response =>{
            console.log('set_memory_clouds : delete memgroups for memory : ' + response.memid);
            {
                clouds.map(cloud =>{
                    console.log('set_memory_clouds : insert into memgroups memid,cloud.id : ' + memoryid + ', ' + cloud.id);
                    return trx.insert({memid:memoryid,groupid:cloud.id}).into('memgroups').returning('memid')
                })
            }
        })
        .then(trx.commit)
        .then(()=>{
            res.json({
                success:true,
                data:null,
                error:null
                })
            })
        .catch(trx.rollback).then(err =>{
            res.json({
                success:false,
                data:null,
                error:err
             })
    })
    })
})

// -------------------------------------------------------------------------------------

    app.post('/set_memory_description',(req,res) =>{

        const {memoryid,newDescription} = req.body
        console.log('set_memory_description req with body :' + memoryid + ' : ' + newDescription) 
        
        db('memories')
        .where({memid:memoryid})
        .update({description:newDescription})
        .catch(err=> {
            console.log('db exception : ' + err)
            res.json({
                success:false,
                data:null,
                error:err
            })
        })
        console.log('db update success : ' + true)
        res.json({
            success:true,
            data:null,
            error:null
        })
        
    })
// -------------------------------------------------------------------------------------

    app.post('/set_memory_location',(req,res) =>{

        const {memoryid,newLocation} = req.body
        console.log('set_memory_location req with body :' + memoryid + ' : ' + newLocation) 
        
        db('memories')
        .where({memid:memoryid})
        .update({location:newLocation})
        .catch(err=> {
            console.log('db exception : ' + err)
            res.json({
                success:false,
                data:null,
                error:err
            })
        })
        console.log('db update success : ' + true)
        res.json({
            success:true,
            data:null,
            error:null})
        
    })

// -------------------------------------------------------------------------------------

    app.post('/set_memory_story',(req,res) =>{

        const {memoryid,newStory} = req.body
        let len = 0
        if(newStory){len=newStory.len}
        console.log('set_memory_story req with body :' + memoryid + ' : new story  ' + len + ' chars long') 
        
        db('memories')
        .where({memid:memoryid})
        .update({story:newStory})
        .catch(err=> {
            console.log('db exception : ' + err)
            res.json({
                success:false,
                data:null,
                error:err
            })
        })
        console.log('db update success : ' + true)
        res.json({
            success:true,
            data:null,
            error:null})
        
    })



// -------------------------------------------------------------------------------

app.post('/transcode_mp4_HLS_Playlist',(req,res) => {
    const {mp4filekey} = req.body

    let fname = mp4filekey.split('.')[0]
    
    let params = {
        PipelineId: process.env.TRANSCODE_PIPE,
        Input: {
            Key: mp4filekey,
            AspectRatio: 'auto',
            FrameRate: 'auto',
            Resolution: 'auto',
            Container: 'auto',
            Interlaced: 'auto'
        },
        OutputKeyPrefix: fname + '/',
        Outputs: [
            {
                Key: 'hls_2000',
                PresetId: "1351620000001-200015",
                SegmentDuration: "10"
            },
            {
                Key: 'hls_1500',
                PresetId: "1351620000001-200025",
                SegmentDuration: "10"
            }
            ],
        Playlists: [
            {
                Format: 'HLSv3',
                Name: 'hls_master',
                OutputKeys: [
                    'hls_2000',
                    'hls_1500'
                ]
            },
        ]
    }

    createJob(params)

    .then(result =>{
        console.log('transcode_mp4_HLS success : job id -> ' + JSON.stringify(result.Job.Id));
        res.json( {
            success:true,
            data:fname + '/' + 'hls_master.m3u8',
            error:null
         }) 
    }).catch(err =>{
        console.log('transcode_mp4_HLS error ' + JSON.stringify(err));
        res.json( {
            success:false,
            data:null,
            error:err
        })}  
    )
    
})

// -------------------------------------------------------------------------------

async function createJob(params) {
    return new Promise((resolve, reject) => {
        let transcoder = new aws.ElasticTranscoder();
        transcoder.createJob(params, (err, data) => {
            
            if(err){
                console.log('createJob err  : '  + JSON.stringify(err));
                reject("err: " + err)
            }else{
                console.log('createJob job : '  + data);
                resolve(data)
            }
        })
    })
}

// -------------------------------------------------------------------------------

app.listen(process.env.PORT || 3000,()=> {
    console.log('app running on port ${process.env.PORT}');
})