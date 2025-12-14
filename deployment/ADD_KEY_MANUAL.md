# Manual Steps to Add SSH Key

Your new key pair has been created:
- **Private Key**: `deployment/chatappKeyPair.pem`
- **Public Key**: `deployment/chatappKeyPair.pub`

The key has been added to the **bastion host** ✅

Now you need to add it to the **backend instance**. Here are the steps:

## Option 1: Using EC2 Instance Connect (Easiest)

1. **Add temporary key to backend instance:**
   ```bash
   cd deployment
   aws ec2-instance-connect send-ssh-public-key \
     --instance-id i-07b8b7267334ba92d \
     --availability-zone us-east-1b \
     --instance-os-user ec2-user \
     --ssh-public-key file://chatappKeyPair.pub \
     --region us-east-1
   ```

2. **Connect via bastion (you have 60 seconds):**
   ```bash
   ssh -i chatappKeyPair.pem -J ec2-user@98.92.178.139 ec2-user@10.0.4.55
   ```

3. **Once connected, add the key permanently:**
   ```bash
   mkdir -p ~/.ssh
   chmod 700 ~/.ssh
   echo 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAACAQDanAAfIuiQ6sPOiy4DjoY9oVdZpBCYCNkfhIq+i+ef8BkhyQJEj8bZPlxodJSzi1RzgxbwqqWjNsAJezp0NJhTKgz+Wk20PahHKcMInTxNnsxd4CLxJKQI2EPkdd9AtQosRaWL/9EKXwXg1n+jgXJibAw9Qb1I4+KIkmZiyClF3ntsiFeriHJPZA+UfQNBWw88Sfd1Aezam09nxDnEFDaIDET+B8ytODQ76P8BE2Mj3NfsHIlu60hBYmNHN18PMMj5OalyQn+DijnZqgDnMhrdMBkTJ3O6BXSj07YRPzs6S+1Bpawum+lcuDgJbrICy7+BUwEs5OUt7ek9dx05iaXVggiX4Onu2466w4XAtMpg7ZOzN+LDGAk1cVAHJgV+jC0Z1sfhbzAa2ge2IRqsiHTXMkV74rv4ENXQOhkuMOMcy7IEA5PqhpVlyqJiPALezyuS2yixhGCkZgn/Djvsdb5tyvyfABj2QpEQaZ2YGtx7qNtDDuhw3cb/MTmyTUKFsgEKC7SR+fl5XBSPA5W48nvI8xl8OnAkDj2rdwvNd6n3nZuPwCgKbpypV2PARkn0aZZGdCIo8RW4qHMVQb463PLQcBJn8N+xErmrBOd0hs/kF64omANVknS+5S0EVDWsNA7MLPG1ZuE5wXBZkadvzcBIpcjmm+qwCN+68IPOyhhk/Q== chatapp-ec2-key' >> ~/.ssh/authorized_keys
   chmod 600 ~/.ssh/authorized_keys
   exit
   ```

4. **Test the connection:**
   ```bash
   ssh -i chatappKeyPair.pem -J ec2-user@98.92.178.139 ec2-user@10.0.4.55
   ```

## Option 2: Two-Step Connection

1. **Connect to bastion:**
   ```bash
   cd deployment
   ssh -i chatappKeyPair.pem ec2-user@98.92.178.139
   ```

2. **From bastion, you'll need the old key or use EC2 Instance Connect:**
   - If you have the old key, copy it to bastion first
   - Or use EC2 Instance Connect to get temporary access to backend

3. **Once on backend, add the new key:**
   ```bash
   mkdir -p ~/.ssh
   chmod 700 ~/.ssh
   # Copy the public key content from chatappKeyPair.pub
   echo '<paste-public-key-here>' >> ~/.ssh/authorized_keys
   chmod 600 ~/.ssh/authorized_keys
   ```

## Quick Reference

**Public Key Content:**
```
ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAACAQDanAAfIuiQ6sPOiy4DjoY9oVdZpBCYCNkfhIq+i+ef8BkhyQJEj8bZPlxodJSzi1RzgxbwqqWjNsAJezp0NJhTKgz+Wk20PahHKcMInTxNnsxd4CLxJKQI2EPkdd9AtQosRaWL/9EKXwXg1n+jgXJibAw9Qb1I4+KIkmZiyClF3ntsiFeriHJPZA+UfQNBWw88Sfd1Aezam09nxDnEFDaIDET+B8ytODQ76P8BE2Mj3NfsHIlu60hBYmNHN18PMMj5OalyQn+DijnZqgDnMhrdMBkTJ3O6BXSj07YRPzs6S+1Bpawum+lcuDgJbrICy7+BUwEs5OUt7ek9dx05iaXVggiX4Onu2466w4XAtMpg7ZOzN+LDGAk1cVAHJgV+jC0Z1sfhbzAa2ge2IRqsiHTXMkV74rv4ENXQOhkuMOMcy7IEA5PqhpVlyqJiPALezyuS2yixhGCkZgn/Djvsdb5tyvyfABj2QpEQaZ2YGtx7qNtDDuhw3cb/MTmyTUKFsgEKC7SR+fl5XBSPA5W48nvI8xl8OnAkDj2rdwvNd6n3nZuPwCgKbpypV2PARkn0aZZGdCIo8RW4qHMVQb463PLQcBJn8N+xErmrBOd0hs/kF64omANVknS+5S0EVDWsNA7MLPG1ZuE5wXBZkadvzcBIpcjmm+qwCN+68IPOyhhk/Q== chatapp-ec2-key
```

**Instance Info:**
- Bastion: `98.92.178.139` (key already added ✅)
- Backend: `10.0.4.55` (needs key)

