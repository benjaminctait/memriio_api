const express = require('express')
const bparser = require('body-parser')
const bcrypt = require('bcrypt-nodejs')
const cors = require('cors')
const knex = require('knex')
const aws = require('aws-sdk')
const Jimp = require('jimp')
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
    res.json('memriio server is live : version 5')
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
            const returnData = {

                signedRequest: signedURL,
                url: `https://${S3_BUCKET}.s3.amazonaws.com/${fileName}`
            };
                        
            // Send it all back
            res.json( {
                success:true,
                signedURL: returnData.signedRequest,
                url:returnData.url
             }) 
             
        }
    });

})


// get 'GET' signed URL FROM AWS ----------------------------------------------------------------

app.post ('/getObject_signedurl',(req,res) =>{

    console.log('getObject_signedurl', req.body);

    const s3 = new aws.S3(); 
    const fileName = req.body.fileName;
    const fileType = req.body.fileType;


    const s3Params = {
        Bucket: S3_BUCKET,
        Key: fileName,
        Expires: 500,
        ContentType: fileType,
    };
    
    s3.getSignedUrl('getObject', s3Params, (err, signedURL) => {
        if (err) {
            console.log('getobject_signedurl Err : ',err);
            res.json({ success: false, error: err });
        }else{
            res.json( {
                success:true,
                signedURL: signedURL,
                error=null
             }) 
             
        }
    });

})

// create memory --------------------------------------------------

app.post('/creatememory',(req,res) => {
    const {userid,title,story,description,location} = req.body
    
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
          
    })
        .then(memoryids=> {
            if(memoryids.length > 0){
                res.json({
                    created:true,
                    memid:memoryids[0]
                })
            }else{
                res.json({
                    created:false,
                    memid:0
                })
            }
        })
        .catch(err=> json(err))
})

// Add file to memory ---------

app.post('/associateFile',(req,res) => {
    const{memid,fileurl,fileext,ishero} = req.body;
    

    db('memfiles').returning('id')
        .insert({
            memid:memid,
            fileurl:fileurl,
            fileext:fileext,
            ishero:ishero
        })
        .then(result =>{
            res.json(result[0]);  // returns the memory id if successfull

        }).catch(err => res.status(400).json(err))
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

// -------------------------------------------------------------------------------------------

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
            res.json(result[0]); // returns the memory id if successfull
        })
        .catch(err=> res.status(400).json('unable to associate'))
})

// Associate a groupID with a memory ----------------------------------------------------------------

app.post('/associateGroup',(req,res) => {
    const {memid,groupid} = req.body
    
    db('memgroups')
        .returning('memid')
        .insert({
            memid:memid,
            groupid:groupid
    })
        .then(result=> {
            res.json(result[0]); // returns the memory id if successfull
        })
        .catch(err=> res.status(400).json('unable to associate'))
})

// profile/id ----------------------------------------------------------------

app.get('/profile/:id',(req,res) =>{

    const { userid } = req.params;
    
    db.select('*').from('users').where({userid:userid}).then(users=>{
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

    const { userid } = req.params;
    
    db.select('*').from('memories').where({userid:userid}).then(memories=>{
        if(memories.length){
            res.json(memories[0])
        }else{
            res.status(400).json('memory not found')
        }
    })
    .catch(err=> res.status(400).json('error getting user memory'))
})

// search ----------------------------------------------------------------

app.post('/get_memories_keywords_user',(req,res) =>{

    const {words,userid} = req.body
    console.log('get_memories_keywords_user : userid : ' + userid + ' words ' + words);
    
    
    db.select(  'memories.memid', 
                'memories.userid',
                'memories.title',
                'memories.description',
                'memories.location',
                'memories.story',
                'memories.createdon',
                'memories.cardtype',
                'memfiles.fileurl',
                'memfiles.fileext')
    .from('memories').join('memfiles', function() {
        this.on('memfiles.memid', '=', 'memories.memid').onIn('memfiles.ishero',[true])})
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
        console.log('get_memories_keywords_user : memories : ' + memories )
        if(Array.isArray(memories)){
            console.log('get_memories_keywords_user : success = ' + true);
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

// search user ----------------------------------------------------------------

app.post('/get_memories_userid',(req,res) =>{

    const {userid} = req.body
    
    db.select('memories.memid', 
              'memories.userid',
              'memories.title',
              'memories.description',
              'memories.location',
              'memories.story',
              'memories.createdon',
              'memories.cardtype',
              'memfiles.fileurl',
              'memfiles.fileext')
    .from('memories').join('memfiles', function() {
        this.on('memfiles.memid', '=', 'memories.memid').onIn('memfiles.ishero',[true])
      })
    .where({userid:userid})
        .orWhereIn('memories.memid',function(){this.select('memid').from('memgroups')
             .whereIn('memgroups.groupid',function(){this.select('groupid').from('memberships').where({userid:userid})})})
    .orderBy('memories.createdon','desc')

    .then(memories=>{
        console.log('get_memories_userid : memories : ' + memories )
        if(memories.length){
            res.json(memories)
        }else{
            res.status(400).json('no matching memories found')
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
    console.log('set_searchwords_memid : memid ' + memid + ' words ' + JSON.stringify(searchwords));
    
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
            console.log('set_searchwords_memid : error = ' + err);
            res.json({
                success:false,
                data:null,
                error:err
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
        console.log('db returned : ' + JSON.stringify(memoryFiles))
        
        if(Array.isArray(memoryFiles)){
            console.log('db memfiles is an array ');
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
        console.log('get_cloud_people_userid returned : ' + JSON.stringify(people))
        if(Array.isArray(people)){
            console.log('get_cloud_people_userid clouds is an array :' + JSON.stringify(people));
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

app.post('/get_cloud_people_clouds',(req,res) =>{

    const cloudIDs = []
    const {clouds} = req.body
    clouds.map(cloud =>{cloudIDs.push(cloud.id)})
    
    db.select('*').from('users').whereIn('users.userid', function(){
        this.select('userid').from('memberships').whereIn('groupid',cloudIDs)})
    .then(people=>{
        console.log('get_cloud_people_clouds returned : ' + JSON.stringify(people))
        if(Array.isArray(people)){
            console.log('get_cloud_people_clouds clouds is an array :' + JSON.stringify(people));
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
const s3 = new aws.S3();

let objects = []
db.select('fileurl')
.from('memfiles')
.where({memid:memoryid})
.then(memoryFiles=>{
    console.log('db returned : ' + JSON.stringify(memoryFiles))
    
    if(Array.isArray(memoryFiles)){
        memoryFiles.map(furl => {
            strarray = furl.fileurl.split('/')            
            keyname = strarray[strarray.length-1]
            console.log('keyname ' + keyname);
            
            objects.push({Key:keyname})
            })
            console.log('objects : ' + objects);
            
    }
    var deleteParam = {
        Bucket: S3_BUCKET,
        Delete: {
            Objects:objects
        }
        
    }

    console.log('deleteparam : ' + JSON.stringify(deleteParam))
    
    s3.deleteObjects(deleteParam, function(err, data) {
        if (err) {
            console.log(err,)
        }else{
            console.log('delete from S3 successfull', JSON.stringify(objects))
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
        } 
    })
})
})

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

// Listen ----------------------------------------------------------------

app.listen(process.env.PORT || 3000,()=> {
    console.log('app running on port ${process.env.PORT}');
})