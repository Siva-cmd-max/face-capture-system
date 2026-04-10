using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace Backend.Models
{
    public class User
    {
        [Key]
        public int Id { get; set; }
        public byte[] Photo { get; set; } = Array.Empty<byte>();
    }

    public class FaceEmbedding
    {
        [Key]
        public int Id { get; set; }
        
        [ForeignKey("User")]
        public int UserId { get; set; }
        public User User { get; set; } = null!;
        
        // JSON string of float array
        public string Embedding { get; set; } = string.Empty;
    }
}
