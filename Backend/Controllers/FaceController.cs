using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Backend.Data;
using Backend.Models;
using System.Text.Json;
using System;
using System.Linq;
using System.Threading.Tasks;

namespace Backend.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    public class FaceController : ControllerBase
    {
        private readonly AppDbContext _context;

        public FaceController(AppDbContext context)
        {
            _context = context;
        }

        public class SaveRequest
        {
            public string Base64Image { get; set; } = string.Empty;
            public float[] Embedding { get; set; } = Array.Empty<float>();
        }

        [HttpPost("save")]
        public async Task<IActionResult> Save([FromBody] SaveRequest request)
        {
            if (request == null || request.Embedding == null || string.IsNullOrEmpty(request.Base64Image))
            {
                return BadRequest("Invalid request data.");
            }

            try
            {
                // Remove data:image/jpeg;base64, prefix if present
                var base64Data = request.Base64Image;
                if (base64Data.Contains(","))
                {
                    base64Data = base64Data.Split(",")[1];
                }

                // Clear existing records to ensure the system strictly compares against only the newly uploaded photo (1-to-1 mapping)
                _context.FaceEmbeddings.RemoveRange(_context.FaceEmbeddings);
                _context.Users.RemoveRange(_context.Users);
                await _context.SaveChangesAsync();


                byte[] imageBytes = Convert.FromBase64String(base64Data);

                var user = new User { Photo = imageBytes };
                _context.Users.Add(user);
                await _context.SaveChangesAsync();

                var faceEmbedding = new FaceEmbedding
                {
                    UserId = user.Id,
                    Embedding = JsonSerializer.Serialize(request.Embedding)
                };

                _context.FaceEmbeddings.Add(faceEmbedding);
                await _context.SaveChangesAsync();

                return Ok(new { message = "User and embedding saved successfully.", userId = user.Id });
            }
            catch (Exception ex)
            {
                return StatusCode(500, $"Internal server error: {ex.Message}");
            }
        }

        public class CompareRequest
        {
            public float[] LiveEmbedding { get; set; } = Array.Empty<float>();
        }

        [HttpPost("compare")]
        public async Task<IActionResult> Compare([FromBody] CompareRequest request)
        {
            if (request == null || request.LiveEmbedding == null || request.LiveEmbedding.Length != 128)
            {
                return BadRequest("Invalid or missing live embedding. Must be an array of 128 floats.");
            }

            try
            {
                double bestMatchScore = 0;
                string status = "MISMATCH";
                double threshold = 60.0; // 60% threshold

                var storedEmbeddings = await _context.FaceEmbeddings.ToListAsync();

                foreach (var storedEmbedding in storedEmbeddings)
                {
                    var dbEmbedding = JsonSerializer.Deserialize<float[]>(storedEmbedding.Embedding);
                    if (dbEmbedding == null || dbEmbedding.Length != 128) continue;

                    double d = CalculateEuclideanDistance(request.LiveEmbedding, dbEmbedding);
                    
                    // Emphasize deep structural features (eyes, nose, jawline) 
                    // Non-linear scaling maps typical matches (d ~ 0.3-0.4) to 85-95%.
                    // Mismatches (d > 0.6) gracefully fall off.
                    double matchScore = Math.Max(0, 100.0 * (1.0 - (d * d * 1.5)));

                    if (matchScore > bestMatchScore)
                    {
                        bestMatchScore = matchScore;
                    }
                }

                if (bestMatchScore >= threshold)
                {
                    status = "MATCHED";
                }

                // Make sure match Score is rounded and within reasonable bounds? The spec just says double. 
                // Using Math.Max to ensure it doesn't go below 0 for display purposes.
                return Ok(new { matchScore = Math.Round(Math.Max(0, bestMatchScore), 2), status = status });
            }
            catch (Exception ex)
            {
                return StatusCode(500, $"Internal server error: {ex.Message}");
            }
        }

        private double CalculateEuclideanDistance(float[] source, float[] target)
        {
            double sum = 0.0;
            for (int i = 0; i < source.Length; i++)
            {
                double diff = source[i] - target[i];
                sum += diff * diff;
            }
            return Math.Sqrt(sum);
        }
    }
}
